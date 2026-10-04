const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('node:path');
const { frontendUrl, uploadDir, nodeEnv, storage } = require('./config/env');
const api = require('./routes');
const mediaAccess = require('./middleware/mediaAccess');
const { HttpError } = require('./utils/http');

const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: frontendUrl, credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use('/uploads', mediaAccess, express.static(uploadDir, { dotfiles: 'deny', maxAge: nodeEnv === 'production' ? '1h' : 0 }));

app.get('/health', async (_req, res) => {
  let database = 'unavailable';
  let mediaStorage = storage.enabled ? 'unavailable' : 'disabled';
  try { await require('./config/prisma').$queryRaw`SELECT 1`; database = 'connected'; } catch { /* status remains unavailable */ }
  if (storage.enabled) { try { mediaStorage = (await require('./services/minio').check()) ? 'connected' : 'unavailable'; } catch { mediaStorage = 'unavailable'; } }
  const healthy = database === 'connected' && (!storage.enabled || mediaStorage === 'connected');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', database, mediaStorage, timestamp: new Date().toISOString() });
});
app.use('/api', api);
app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'That endpoint does not exist.')));
app.use((error, _req, res, _next) => {
  if (error?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'The upload is too large.' } });
  if (error instanceof HttpError) return res.status(error.status).json({ error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
  if (error?.code === 'P2002') return res.status(409).json({ error: { code: 'CONFLICT', message: 'That value is already in use.' } });
  if (nodeEnv !== 'production') console.error(error);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
});

module.exports = app;
