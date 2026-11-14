const { z } = require('zod');
const { HttpError, ok } = require('../utils/http');
const bulkImport = require('../services/bulkImportService');

function createBulkImportController(service = bulkImport) {
  async function users(_req, res) {
    return ok(res, { users: await service.listUsers() });
  }

  async function list(_req, res) {
    return ok(res, { jobs: await service.listJobs() });
  }

  async function create(req, res) {
    try {
      if (!req.file) throw new HttpError(400, 'ZIP_REQUIRED', 'Choose one ZIP archive to import.');
      const parsed = z.object({ targetUserId: z.string().trim().min(1).max(64) }).strict().safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, 'INVALID_TARGET', 'Choose a Gather account for this archive.');
      const job = await service.createJob({
        file: req.file,
        targetUserId: parsed.data.targetUserId,
        requestedBy: req.user.id,
        requestedByUsername: req.user.username
      });
      return ok(res, { job }, 202);
    } finally {
      req.releaseBulkImportSlot?.();
    }
  }

  async function retry(req, res) {
    try {
      if (!req.file) throw new HttpError(400, 'ZIP_REQUIRED', 'Choose the original ZIP archive to retry failed files.');
      const job = await service.retryJob({
        file: req.file,
        jobId: req.params.id,
        requestedBy: req.user.id,
        requestedByUsername: req.user.username
      });
      return ok(res, { job }, 202);
    } finally {
      req.releaseBulkImportSlot?.();
    }
  }

  async function detail(req, res) {
    const job = await service.getJob(req.params.id);
    if (!job) throw new HttpError(404, 'IMPORT_NOT_FOUND', 'That bulk import job could not be found.');
    return ok(res, { job });
  }

  return { users, list, create, retry, detail };
}

module.exports = { ...createBulkImportController(), createBulkImportController };
