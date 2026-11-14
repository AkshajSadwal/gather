const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { uploadDir } = require('../config/env');

const archiveDir = path.join(uploadDir, '.bulk-imports');

function prepareArchiveDir(callback) {
  fs.mkdir(archiveDir, { recursive: true, mode: 0o700 }, (error) => {
    if (error) return callback(error);
    fs.chmod(archiveDir, 0o700, (chmodError) => callback(chmodError && chmodError.code !== 'ENOSYS' && chmodError.code !== 'EPERM' ? chmodError : null, archiveDir));
  });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => prepareArchiveDir((error, destination) => callback(error, destination)),
    filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.incoming`)
  }),
  limits: { fileSize: 1024 * 1024 * 1024, files: 1, fields: 2, parts: 3 },
  fileFilter: (_req, file, callback) => {
    if (path.extname(file.originalname || '').toLowerCase() !== '.zip') {
      return callback(new Error('Choose a .zip archive.'));
    }
    callback(null, true);
  }
});

module.exports = upload;
module.exports.archiveDir = archiveDir;
