const fs = require('node:fs');
const crypto = require('node:crypto');
const {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { storage } = require('../config/env');

const internalClient = new S3Client({
  region: storage.region,
  endpoint: storage.endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: storage.accessKey,
    secretAccessKey: storage.secretKey
  }
});

const publicClient = new S3Client({
  region: storage.region,
  endpoint: storage.publicEndpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: storage.accessKey,
    secretAccessKey: storage.secretKey
  }
});

function assertConfigured() {
  if (!storage.enabled) {
    throw new Error(
      'MinIO storage is not configured. Set MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, and MINIO_BUCKET.'
    );
  }
}

function validateObjectKey(key) {
  if (
    typeof key !== 'string' ||
    key.length < 3 ||
    key.length > 1024 ||
    key.startsWith('/') ||
    key.includes('..') ||
    !/^[A-Za-z0-9/_\-.]+$/.test(key)
  ) {
    throw new Error('Invalid MinIO object key.');
  }
}

function parseReference(reference) {
  if (typeof reference !== 'string' || !reference.startsWith('s3://')) {
    return null;
  }

  const value = reference.slice('s3://'.length);
  const separator = value.indexOf('/');

  if (separator <= 0) return null;

  const bucket = value.slice(0, separator);
  const key = value.slice(separator + 1);

  if (bucket !== storage.bucket) return null;

  validateObjectKey(key);

  return { bucket, key };
}

async function ensureBucket() {
  assertConfigured();

  try {
    await internalClient.send(
      new HeadBucketCommand({
        Bucket: storage.bucket
      })
    );

    return true;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;

    if (status !== 404 && status !== 403) {
      throw error;
    }
  }

  try {
    await internalClient.send(
      new CreateBucketCommand({
        Bucket: storage.bucket
      })
    );

    return true;
  } catch (error) {
    // Bucket already existing is fine.
    const status = error?.$metadata?.httpStatusCode;
    const code = error?.Code || error?.name;

    if (status === 409 || code === 'BucketAlreadyOwnedByYou') {
      return true;
    }

    throw error;
  }
}

async function putFile(filePath, objectKey, contentType) {
  assertConfigured();
  validateObjectKey(objectKey);

  const stats = await fs.promises.stat(filePath);

  if (!stats.isFile()) {
    throw new Error('Upload source is not a regular file.');
  }

  const body = fs.createReadStream(filePath);

  await internalClient.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      ContentLength: stats.size
    })
  );
}

async function deleteObject(objectKey) {
  assertConfigured();
  validateObjectKey(objectKey);

  await internalClient.send(
    new DeleteObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey
    })
  );
}

async function presignGet(
  reference,
  expiresSeconds = storage.presignExpiresSeconds
) {
  assertConfigured();

  const parsed = parseReference(reference);

  if (!parsed) {
    throw new Error('Invalid MinIO storage reference.');
  }

  const expires = Math.min(
    Math.max(Number(expiresSeconds) || 300, 1),
    604800
  );

  return getSignedUrl(
    publicClient,
    new (require('@aws-sdk/client-s3').GetObjectCommand)({
      Bucket: parsed.bucket,
      Key: parsed.key
    }),
    {
      expiresIn: expires
    }
  );
}

async function check() {
  if (!storage.enabled) return true;

  try {
    await ensureBucket();
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  ensureBucket,
  putFile,
  deleteObject,
  presignGet,
  parseReference,
  check
};