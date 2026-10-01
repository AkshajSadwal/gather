const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { uploadDir } = require('../config/env');
const { HttpError } = require('../utils/http');

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

async function identify(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 6).toString().startsWith('GIF8')) return 'image/gif';
  if (buffer.length > 12 && buffer.subarray(4, 8).toString() === 'ftyp') return buffer.subarray(8, 12).toString() === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  if (buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'video/webm';
  return null;
}

async function persistUpload(file) {
  const actualType = await identify(await fs.readFile(file.path));
  if (!actualType || actualType !== file.mimetype || (!imageTypes.has(actualType) && !videoTypes.has(actualType))) {
    await fs.rm(file.path, { force: true });
    throw new HttpError(400, 'INVALID_MEDIA', 'The uploaded file is not a supported image or video.');
  }
  const isVideo = videoTypes.has(actualType);
  const limit = isVideo ? 120 * 1024 * 1024 : 12 * 1024 * 1024;
  if (file.size > limit) {
    await fs.rm(file.path, { force: true });
    throw new HttpError(413, 'FILE_TOO_LARGE', `Maximum size is ${isVideo ? 120 : 12} MB.`);
  }
  const extension = actualType === 'image/jpeg' ? '.jpg' : `.${actualType.split('/')[1].replace('quicktime', 'mov')}`;
  const filename = `${crypto.randomUUID()}${extension}`;
  const target = path.join(uploadDir, filename);
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.rename(file.path, target);
  return { url: `/uploads/${filename}`, type: isVideo ? 'VIDEO' : 'IMAGE', mimeType: actualType, sizeBytes: file.size };
}

async function removeLocal(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  const filename = path.basename(url);
  if (!filename || filename === '.' || filename === '..') return;
  await fs.rm(path.join(uploadDir, filename), { force: true });
}

module.exports = { persistUpload, removeLocal, identify, imageTypes, videoTypes };
