const express = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { frontendUrl } = require('../config/env');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const upload = require('../middleware/bulkArchiveUpload');
const bulkImport = require('../services/bulkImportService');
const { asyncHandler, HttpError } = require('../utils/http');
const { createBulkImportController } = require('../controllers/bulkImportController');

const rateLimitHandler = (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many bulk import requests. Try again later.' } });
const adminAccountKey = (req) => req.user?.id ? `user:${req.user.id}` : `ip:${ipKeyGenerator(req.ip)}`;
const readLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, keyGenerator: adminAccountKey, handler: rateLimitHandler, standardHeaders: 'draft-8', legacyHeaders: false });
const uploadIpLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, keyGenerator: (req) => ipKeyGenerator(req.ip), handler: rateLimitHandler, standardHeaders: 'draft-8', legacyHeaders: false });
const uploadAccountLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, keyGenerator: (req) => req.user?.id || `ip:${ipKeyGenerator(req.ip)}`, handler: rateLimitHandler, standardHeaders: 'draft-8', legacyHeaders: false });

function requireSameOrigin(req, _res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  let expectedOrigin;
  try { expectedOrigin = new URL(frontendUrl).origin; } catch { return next(new HttpError(403, 'ORIGIN_FORBIDDEN', 'This request origin is not allowed.')); }
  if (origin !== expectedOrigin) return next(new HttpError(403, 'ORIGIN_FORBIDDEN', 'This request origin is not allowed.'));
  next();
}

function receiveArchive(uploadMiddleware, req, res, next) {
  uploadMiddleware.single('archive')(req, res, async (error) => {
    if (!error) return next();
    if (req.file?.path) await require('node:fs/promises').rm(req.file.path, { force: true }).catch(() => {});
    req.releaseBulkImportSlot?.();
    if (error.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'ZIP_TOO_LARGE', 'Each ZIP archive must be 1 GB or smaller.'));
    if (error instanceof HttpError) return next(error);
    return next(new HttpError(400, 'INVALID_ARCHIVE_UPLOAD', 'The ZIP archive could not be received. Choose one .zip file and try again.'));
  });
}

function createBulkImportsRouter({ auth = requireAuth, admin = requireAdmin, service = bulkImport, uploadMiddleware = upload } = {}) {
  const router = express.Router();
  const controller = createBulkImportController(service);
  const adminOnly = [auth, admin];
  const reserveSlot = asyncHandler(async (req, _res, next) => {
    req.releaseBulkImportSlot = await service.reserveUpload();
    next();
  });
  const receive = (req, res, next) => receiveArchive(uploadMiddleware, req, res, next);

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/users', ...adminOnly, readLimiter, asyncHandler(controller.users));
  router.get('/', ...adminOnly, readLimiter, asyncHandler(controller.list));
  router.post('/', ...adminOnly, uploadIpLimiter, uploadAccountLimiter, requireSameOrigin, reserveSlot, receive, asyncHandler(controller.create));
  router.post('/:id/retry', ...adminOnly, uploadIpLimiter, uploadAccountLimiter, requireSameOrigin, reserveSlot, receive, asyncHandler(controller.retry));
  router.get('/:id', ...adminOnly, readLimiter, asyncHandler(controller.detail));
  return router;
}

const router = createBulkImportsRouter();
module.exports = router;
module.exports.createBulkImportsRouter = createBulkImportsRouter;
module.exports.requireSameOrigin = requireSameOrigin;
