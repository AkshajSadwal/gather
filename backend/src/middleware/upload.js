const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { uploadDir } = require('../config/env');
const { HttpError } = require('../utils/http');

const tempDir = path.join(uploadDir, '.tmp');
fs.mkdirSync(tempDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempDir),
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.upload`)
  }),
  limits: { fileSize: 120 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowed.includes(file.mimetype)) return cb(new HttpError(400, 'INVALID_MEDIA', 'Upload a JPEG, PNG, WEBP, GIF, MP4, WEBM, or MOV file.'));
    cb(null, true);
  }
});

module.exports = upload;
