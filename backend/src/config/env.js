const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

module.exports = {
  port: Number(process.env.BACKEND_PORT || 4000),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  authSecret: process.env.AUTH_SECRET,
  internalAuthSecret: process.env.INTERNAL_AUTH_SECRET,
  uploadDir: path.resolve(__dirname, '../../../', process.env.UPLOAD_DIR || 'uploads'),
  nodeEnv: process.env.NODE_ENV || 'development'
};
