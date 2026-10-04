const fs = require('node:fs');
const crypto = require('node:crypto');
const { storage } = require('../config/env');

function awsEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalPath(bucket, key = '') {
  return `/${awsEncode(bucket)}${key ? `/${key.split('/').map(awsEncode).join('/')}` : ''}`;
}

function canonicalQuery(query) {
  return Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join('&');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function signingKey(secret, dateStamp, region, service) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), service), 'aws4_request');
}

function hostHeader(url) {
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
}

function buildSignedHeaders(headers) {
  return Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([a], [b]) => a.localeCompare(b));
}

function createSigningContext(method, bucket, key, query, headers, payloadHash, now = new Date()) {
  const url = new URL(storage.endpoint);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';
  const region = storage.region;
  const path = canonicalPath(bucket, key);
  const signed = buildSignedHeaders({ ...headers, host: hostHeader(url) });
  const canonicalHeaders = signed.map(([name, value]) => `${name}:${value}\n`).join('');
  const signedHeaders = signed.map(([name]) => name).join(';');
  const canonicalRequest = [
    method.toUpperCase(),
    path,
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest)
  ].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(storage.secretKey, dateStamp, region, service)).update(stringToSign).digest('hex');
  return { url, amzDate, authorization: `AWS4-HMAC-SHA256 Credential=${storage.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`, signedHeaders: Object.fromEntries(signed) };
}

async function s3Request(method, bucket, key, { query = {}, headers = {}, body, payloadHash = 'UNSIGNED-PAYLOAD' } = {}) {
  const signing = createSigningContext(method, bucket, key, query, headers, payloadHash);
  const requestHeaders = {
    ...headers,
    Host: hostHeader(signing.url),
    'x-amz-date': signing.amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: signing.authorization
  };
  const target = new URL(signing.url);
  target.pathname = canonicalPath(bucket, key).replace(/%2F/g, '/');
  target.search = canonicalQuery(query);
  const response = await fetch(target, {
    method,
    headers: requestHeaders,
    body,
    duplex: body ? 'half' : undefined
  });
  return response;
}

function assertConfigured() {
  if (!storage.enabled) throw new Error('MinIO storage is not configured. Set MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, and MINIO_BUCKET.');
}

function validateObjectKey(key) {
  if (typeof key !== 'string' || key.length < 3 || key.length > 1024 || key.startsWith('/') || key.includes('..') || !/^[A-Za-z0-9/_\-.]+$/.test(key)) {
    throw new Error('Invalid MinIO object key.');
  }
}

async function ensureBucket() {
  assertConfigured();
  let lastError;
  for (let attempt = 1; attempt <= storage.startupRetries; attempt += 1) {
    try {
      const head = await s3Request('HEAD', storage.bucket, '');
      if (head.ok) return true;
      if (head.status !== 404) {
        const detail = await head.text().catch(() => '');
        throw new Error(`MinIO bucket check failed (${head.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
      }
      const create = await s3Request('PUT', storage.bucket, '', { payloadHash: sha256Hex('') });
      if (create.ok || create.status === 409) return true;
      const detail = await create.text().catch(() => '');
      throw new Error(`MinIO bucket creation failed (${create.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    } catch (error) {
      lastError = error;
      if (attempt < storage.startupRetries) await new Promise((resolve) => setTimeout(resolve, storage.startupRetryDelayMs));
    }
  }
  throw lastError || new Error('MinIO is unavailable.');
}

async function putFile(filePath, objectKey, contentType) {
  assertConfigured();
  validateObjectKey(objectKey);
  const stats = await fs.promises.stat(filePath);
  if (!stats.isFile()) throw new Error('Upload source is not a regular file.');
  const payloadHash = await sha256File(filePath);
  const body = fs.createReadStream(filePath);
  const response = await s3Request('PUT', storage.bucket, objectKey, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stats.size)
    },
    body,
    payloadHash
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`MinIO upload failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}

async function deleteObject(objectKey) {
  assertConfigured();
  validateObjectKey(objectKey);
  const response = await s3Request('DELETE', storage.bucket, objectKey, { payloadHash: sha256Hex('') });
  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => '');
    throw new Error(`MinIO delete failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
}

function parseReference(reference) {
  if (typeof reference !== 'string' || !reference.startsWith('s3://')) return null;
  const value = reference.slice('s3://'.length);
  const separator = value.indexOf('/');
  if (separator <= 0) return null;
  const bucket = value.slice(0, separator);
  const key = value.slice(separator + 1);
  if (bucket !== storage.bucket) return null;
  validateObjectKey(key);
  return { bucket, key };
}

function presignGet(reference, expiresSeconds = storage.presignExpiresSeconds) {
  assertConfigured();
  const parsed = parseReference(reference);
  if (!parsed) throw new Error('Invalid MinIO storage reference.');
  const expires = Math.min(Math.max(Number(expiresSeconds) || 300, 1), 604800);
  const now = new Date();
  const url = new URL(storage.publicEndpoint);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = storage.region;
  const service = 's3';
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const query = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${storage.accessKey}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host'
  };
  const path = canonicalPath(parsed.bucket, parsed.key);
  const canonicalHeaders = `host:${hostHeader(url)}\n`;
  const canonicalRequest = [
    'GET',
    path,
    canonicalQuery(query),
    canonicalHeaders,
    'host',
    'UNSIGNED-PAYLOAD'
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest)
  ].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(storage.secretKey, dateStamp, region, service)).update(stringToSign).digest('hex');
  const target = new URL(url);
  target.pathname = path.replace(/%2F/g, '/');
  target.search = canonicalQuery({ ...query, 'X-Amz-Signature': signature });
  return target.toString();
}

async function check() {
  try {
    await ensureBucket();
    return true;
  } catch {
    return false;
  }
}

module.exports = { ensureBucket, putFile, deleteObject, presignGet, parseReference, check };
