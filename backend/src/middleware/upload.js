const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { uploadDir } = require('../config/env');
const { HttpError } = require('../utils/http');
const { matchesDeclaredMediaType } = require('../utils/mediaSignature');

const tempDir = path.join(uploadDir, '.tmp');
fs.mkdirSync(tempDir, { recursive: true });

const multerUpload = multer({
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

function validateContent(handler) {
  return (req, res, next) => handler(req, res, (error) => {
    if (error) return next(error);
    const files = [...(req.file ? [req.file] : []), ...(req.files || [])];
    Promise.all(files.map(async (file) => {
      const handle = await fs.promises.open(file.path, 'r');
      try {
        const header = Buffer.alloc(16);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        return matchesDeclaredMediaType(header.subarray(0, bytesRead), file.mimetype);
      } finally { await handle.close(); }
    })).then(async (valid) => {
      if (valid.every(Boolean)) return next();
      await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => {})));
      req.file = undefined;
      req.files = [];
      next(new HttpError(400, 'INVALID_MEDIA_CONTENT', 'The uploaded file content does not match its media type.'));
    }).catch(async (validationError) => {
      await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => {})));
      next(validationError);
    });
  });
}

module.exports = {
  single: (field) => validateContent(multerUpload.single(field)),
  array: (field, maxCount) => validateContent(multerUpload.array(field, maxCount))
};
