const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream } = require('node:fs');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const prismaDefault = require('../config/prisma');
const { uploadDir: uploadDirDefault, storage: storageDefault } = require('../config/env');
const { detectMediaType } = require('../utils/mediaSignature');
const { putFile: putFileDefault, deleteObject: deleteObjectDefault } = require('./minio');
const { HttpError } = require('../utils/http');

const execFileAsync = promisify(execFile);
const ZIP_HELPER = path.resolve(__dirname, '../../scripts/bulk-import-zip.py');
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const TERMINAL_FILE_STATES = new Set(['created', 'skipped', 'failed']);
const SAFE_FILE_ERRORS = new Set([
  'The extracted file did not match its declared image or video type.',
  'The ZIP entry could not be read. Upload the archive again if the problem continues.',
  'The media could not be stored. Check storage and database health, then retry the ZIP.'
]);

function safeName(value, fallback = 'archive.zip') {
  const leaf = String(value || '').replace(/\\/g, '/').split('/').pop() || fallback;
  return leaf.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || fallback;
}

function makeHttpError(status, code, message) {
  return new HttpError(status, code, message);
}

function createBulkImportService(dependencies = {}) {
  const prisma = dependencies.prisma || prismaDefault;
  const putFile = dependencies.putFile || putFileDefault;
  const deleteObject = dependencies.deleteObject || deleteObjectDefault;
  const storage = dependencies.storage || storageDefault;
  const uploadDir = dependencies.uploadDir || uploadDirDefault;
  const archiveDir = path.join(uploadDir, '.bulk-imports');
  const pythonBinary = dependencies.pythonBinary || (process.platform === 'win32' ? 'python' : 'python3');
  const logger = dependencies.logger || console;
  const execZipHelper = dependencies.runZipHelper || (async (...args) => {
    try {
      const { stdout } = await execFileAsync(pythonBinary, [ZIP_HELPER, ...args], {
        maxBuffer: 5 * 1024 * 1024,
        timeout: 5 * 60 * 1000,
        windowsHide: true
      });
      return stdout;
    } catch (error) {
      if (error.code === 'ENOENT') throw makeHttpError(503, 'ZIP_PROCESSOR_UNAVAILABLE', 'The ZIP processor is unavailable.');
      error.bulkImportZipFailure = true;
      throw error;
    }
  });

  const queue = [];
  const queuedIds = new Set();
  const runningIds = new Set();
  const jobCache = new Map();
  let workerStarted = false;
  let workerPromise = null;
  let createTail = Promise.resolve();
  let uploadReserved = false;

  async function ensureArchiveDir() {
    await fs.mkdir(archiveDir, { recursive: true, mode: 0o700 });
    await fs.chmod(archiveDir, 0o700).catch(() => {});
  }

  function cacheJob(job) {
    jobCache.set(job.id, job);
    if (jobCache.size > 100) {
      for (const [id] of jobCache) {
        if (!queuedIds.has(id) && !runningIds.has(id)) jobCache.delete(id);
        if (jobCache.size <= 100) break;
      }
    }
  }

  function jobPath(id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return path.join(archiveDir, `${id}.json`);
  }

  function archivePath(id) {
    return path.join(archiveDir, `${id}.zip`);
  }

  async function readJob(id) {
    const filename = jobPath(id);
    if (!filename) return null;
    if (jobCache.has(id)) return jobCache.get(id);
    try {
      const job = JSON.parse(await fs.readFile(filename, 'utf8'));
      cacheJob(job);
      return job;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function writeJob(job) {
    await ensureArchiveDir();
    const destination = jobPath(job.id);
    if (!destination) throw new Error('Invalid persisted import job identifier.');
    const temporary = `${destination}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const handle = await fs.open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(job, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    let renameError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fs.rename(temporary, destination);
        renameError = null;
        break;
      } catch (error) {
        renameError = error;
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 4) break;
        await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
    if (renameError) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw renameError;
    }
    await fs.chmod(destination, 0o600).catch(() => {});
    cacheJob(job);
  }

  async function listRawJobs() {
    await ensureArchiveDir();
    const names = await fs.readdir(archiveDir);
    const jobs = [];
    for (const name of names.filter((item) => /^[0-9a-f-]{36}\.json$/i.test(item))) {
      try {
        const job = await readJob(name.slice(0, -5));
        if (job) jobs.push(job);
      } catch {
        logger.warn('[bulk-import] Ignored an unreadable persisted job record.');
      }
    }
    return jobs.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  async function sha256File(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  async function inspectZip(filePath) {
    let text;
    try {
      text = await execZipHelper('list', filePath);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw makeHttpError(400, 'INVALID_ARCHIVE', 'The ZIP archive is malformed or exceeds a safety limit.');
    }
    let manifest;
    try { manifest = JSON.parse(text); } catch { throw makeHttpError(400, 'INVALID_ARCHIVE', 'The ZIP archive could not be validated.'); }
    if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 500) {
      throw makeHttpError(400, 'NO_SUPPORTED_MEDIA', 'The ZIP must contain 1–500 eligible JPG/JPEG photos or MP4 videos.');
    }
    const entries = manifest.files.map((entry) => {
      if (!Number.isInteger(entry.index) || entry.index < 0 || !['image', 'video'].includes(entry.kind) || !Number.isInteger(entry.size)) {
        throw makeHttpError(400, 'INVALID_ARCHIVE', 'The ZIP archive contains invalid media metadata.');
      }
      const limit = entry.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (entry.size <= 0 || entry.size > limit) throw makeHttpError(400, 'INVALID_ARCHIVE', 'A media file exceeds its size limit.');
      return { index: entry.index, name: safeName(entry.name, 'media file'), kind: entry.kind, size: entry.size, status: 'pending', attempts: 0, error: null };
    });
    return { entries, ignoredFiles: Math.max(0, Number(manifest.ignoredCount) || 0) };
  }

  function refreshCounts(job) {
    const entries = Array.isArray(job.entries) ? job.entries : [];
    job.totalFiles = entries.length;
    job.processedFiles = entries.filter((entry) => TERMINAL_FILE_STATES.has(entry.status)).length;
    job.createdPosts = entries.filter((entry) => entry.status === 'created' && entry.kind === 'image').length;
    job.createdReels = entries.filter((entry) => entry.status === 'created' && entry.kind === 'video').length;
    job.skippedFiles = entries.filter((entry) => entry.status === 'skipped').length;
    job.failedFiles = entries.filter((entry) => entry.status === 'failed').length;
    job.errors = entries.filter((entry) => entry.status === 'failed').slice(0, 50).map((entry) => ({ file: safeName(entry.name, 'media file'), message: safeFileError(entry.error) }));
  }

  function safeFileError(message) {
    if (SAFE_FILE_ERRORS.has(message)) return message;
    return 'The media could not be stored. Check storage and database health, then retry the ZIP.';
  }

  function safeJobMessage(job) {
    if (job.status === 'queued') return 'Waiting to start.';
    if (job.status === 'processing') return `Processed ${job.processedFiles || 0} of ${job.totalFiles || 0} files.`;
    if (job.status === 'completed') return 'Import completed successfully.';
    if (job.status === 'completed_with_errors') return 'Import finished with failed files. Re-upload the same ZIP to retry; successful items will be skipped.';
    return 'Import failed. Re-upload the ZIP after checking service health.';
  }

  function publicJob(job) {
    const status = runningIds.has(job.id) && ['completed', 'completed_with_errors', 'failed'].includes(job.status) ? 'processing' : job.status;
    const legacyErrors = Array.isArray(job.errors) ? job.errors : [];
    const errors = Array.isArray(job.entries)
      ? job.entries.filter((entry) => entry.status === 'failed').slice(0, 50).map((entry) => ({ file: safeName(entry.name, 'media file'), message: safeFileError(entry.error) }))
      : legacyErrors.slice(0, 50).map((entry) => ({ file: safeName(entry.file, 'media file'), message: safeFileError(entry.message) }));
    return {
      id: job.id,
      status,
      targetUserId: job.targetUserId,
      targetUsername: safeName(job.targetUsername, 'account'),
      requestedBy: job.requestedBy || null,
      requestedByUsername: job.requestedByUsername ? safeName(job.requestedByUsername, 'admin') : null,
      retryOf: job.retryOf || null,
      archiveName: safeName(job.archiveName),
      archiveBytes: Number(job.archiveBytes) || 0,
      totalFiles: Number(job.totalFiles) || 0,
      ignoredFiles: Number(job.ignoredFiles) || 0,
      processedFiles: Number(job.processedFiles) || 0,
      createdPosts: Number(job.createdPosts) || 0,
      createdReels: Number(job.createdReels) || 0,
      skippedFiles: Number(job.skippedFiles) || 0,
      failedFiles: Number(job.failedFiles) || 0,
      currentFile: job.currentFile ? safeName(job.currentFile, 'media file') : null,
      errors,
      message: status === 'processing' ? `Processed ${job.processedFiles || 0} of ${job.totalFiles || 0} files.` : safeJobMessage(job),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };
  }

  async function cleanupInterruptedFiles() {
    const entries = await fs.readdir(archiveDir, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isFile() && (entry.name.endsWith('.work') || entry.name.endsWith('.tmp'))).map(async (entry) => {
      await fs.rm(path.join(archiveDir, entry.name), { force: true }).catch(() => {});
    }));
    const cutoff = Date.now() - 60 * 60 * 1000;
    const persistedJobIds = new Set(entries.filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.json$/i.test(entry.name)).map((entry) => entry.name.slice(0, -5)));
    await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.incoming')).map(async (entry) => {
      const filename = path.join(archiveDir, entry.name);
      try { if ((await fs.stat(filename)).mtimeMs < cutoff) await fs.rm(filename, { force: true }); } catch { /* A concurrent cleanup can win. */ }
    }));
    await Promise.all(entries.filter((entry) => entry.isFile() && /^[0-9a-f-]{36}\.zip$/i.test(entry.name) && !persistedJobIds.has(entry.name.slice(0, -4))).map(async (entry) => {
      const filename = path.join(archiveDir, entry.name);
      try { if ((await fs.stat(filename)).mtimeMs < cutoff) await fs.rm(filename, { force: true }); } catch { /* A concurrent cleanup can win. */ }
    }));
  }

  function queueJob(id) {
    if (queuedIds.has(id) || runningIds.has(id)) return;
    queuedIds.add(id);
    queue.push(id);
    if (workerStarted) void drainQueue();
  }

  async function hasActiveJob() {
    if (queue.length || queuedIds.size || runningIds.size) return true;
    const jobs = await listRawJobs();
    return jobs.some((job) => ['queued', 'processing'].includes(job.status));
  }

  async function reserveUpload() {
    if (uploadReserved) throw makeHttpError(409, 'BULK_IMPORT_BUSY', 'Another bulk import is already being uploaded or processed.');
    uploadReserved = true;
    try {
      if (await hasActiveJob()) throw makeHttpError(409, 'BULK_IMPORT_BUSY', 'Wait for the current bulk import to finish before uploading another ZIP.');
      let released = false;
      return () => { if (!released) { released = true; uploadReserved = false; } };
    } catch (error) {
      uploadReserved = false;
      throw error;
    }
  }

  async function readHeader(filePath, length = 4) {
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally { await handle.close(); }
  }

  async function detectFileType(filePath) {
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return detectMediaType(buffer.subarray(0, bytesRead));
    } finally { await handle.close(); }
  }

  async function objectIsReferenced(objectKey) {
    const [postMedia, reelMedia] = await Promise.all([
      prisma.postMedia.findFirst({ where: { objectKey }, select: { id: true } }),
      prisma.reelMedia.findFirst({ where: { objectKey }, select: { id: true } })
    ]);
    return Boolean(postMedia || reelMedia);
  }

  async function cleanupUnreferencedObject(objectKey) {
    try { if (!await objectIsReferenced(objectKey)) await deleteObject(objectKey); } catch { /* Preserve data when reference state is uncertain. */ }
  }

  async function importImage({ filePath, job, digest, size }) {
    const objectKey = `bulk-imports/${job.targetUserId}/posts/${digest}.jpg`;
    if (await prisma.postMedia.findFirst({ where: { objectKey }, select: { id: true } })) return 'skipped';
    const url = `s3://${storage.bucket}/${objectKey}`;
    try {
      await putFile(filePath, objectKey, 'image/jpeg');
      await prisma.post.create({
        data: {
          authorId: job.targetUserId,
          caption: '',
          media: { create: { url, objectKey, type: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: size, position: 0 } }
        }
      });
      return 'created';
    } catch (error) {
      await cleanupUnreferencedObject(objectKey);
      throw error;
    }
  }

  async function importVideo({ filePath, job, digest, size }) {
    const objectKey = `bulk-imports/${job.targetUserId}/reels/${digest}.mp4`;
    if (await prisma.reelMedia.findFirst({ where: { objectKey }, select: { id: true } })) return 'skipped';
    const url = `s3://${storage.bucket}/${objectKey}`;
    try {
      await putFile(filePath, objectKey, 'video/mp4');
      await prisma.$transaction(async (tx) => {
        const post = await tx.post.create({
          data: {
            authorId: job.targetUserId,
            caption: '',
            media: { create: { url, objectKey, type: 'VIDEO', mimeType: 'video/mp4', sizeBytes: size, position: 0 } }
          },
          select: { id: true }
        });
        await tx.reel.create({
          data: {
            authorId: job.targetUserId,
            postId: post.id,
            caption: '',
            media: { create: { url, objectKey, mimeType: 'video/mp4', sizeBytes: size } }
          }
        });
      });
      return 'created';
    } catch (error) {
      await cleanupUnreferencedObject(objectKey);
      throw error;
    }
  }

  async function createJobInternal({ file, targetUserId, requestedBy, requestedByUsername, retryOf = null, expectedHash = null, expectedArchiveName = null, expectedArchiveBytes = null }) {
    let finalArchivePath = null;
    try {
      if (!file?.path) throw makeHttpError(400, 'ZIP_REQUIRED', 'Choose one ZIP archive to import.');
      const stat = await fs.stat(file.path);
      if (!stat.isFile() || stat.size <= 4 || stat.size > MAX_ARCHIVE_BYTES) {
        throw makeHttpError(413, 'ZIP_TOO_LARGE', 'The ZIP archive must be larger than 4 bytes and no larger than 1 GB.');
      }
      const header = await readHeader(file.path);
      if (header.length < 2 || header[0] !== 0x50 || header[1] !== 0x4b) {
        throw makeHttpError(400, 'INVALID_ARCHIVE', 'The uploaded file is not a ZIP archive.');
      }
      const user = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, username: true } });
      if (!user) throw makeHttpError(404, 'TARGET_USER_NOT_FOUND', 'The selected Gather account no longer exists.');
      const active = await hasActiveJob();
      if (active) throw makeHttpError(409, 'BULK_IMPORT_BUSY', 'Wait for the current bulk import to finish before uploading another ZIP.');

      const archiveSha256 = await sha256File(file.path);
      const archiveName = safeName(file.originalname, 'archive.zip');
      if (expectedHash && archiveSha256 !== expectedHash) {
        throw makeHttpError(400, 'RETRY_ARCHIVE_MISMATCH', 'Choose the same ZIP archive used by the original import.');
      }
      if (!expectedHash && expectedArchiveBytes != null && (stat.size !== expectedArchiveBytes || archiveName !== expectedArchiveName)) {
        throw makeHttpError(400, 'RETRY_ARCHIVE_MISMATCH', 'Choose the same ZIP archive used by the original import.');
      }
      const { entries, ignoredFiles } = await inspectZip(file.path);
      const id = crypto.randomUUID();
      finalArchivePath = archivePath(id);
      await fs.rename(file.path, finalArchivePath);
      await fs.chmod(finalArchivePath, 0o600).catch(() => {});
      const now = new Date().toISOString();
      const job = {
        id,
        status: 'queued',
        targetUserId: user.id,
        targetUsername: user.username,
        requestedBy,
        requestedByUsername: safeName(requestedByUsername, 'admin'),
        retryOf,
        archiveName,
        archiveBytes: stat.size,
        archiveSha256,
        entries,
        ignoredFiles,
        totalFiles: entries.length,
        processedFiles: 0,
        createdPosts: 0,
        createdReels: 0,
        skippedFiles: 0,
        failedFiles: 0,
        currentFile: null,
        errors: [],
        message: 'Waiting to start.',
        createdAt: now,
        updatedAt: now
      };
      await writeJob(job);
      queueJob(id);
      return publicJob(job);
    } catch (error) {
      if (finalArchivePath) await fs.rm(finalArchivePath, { force: true }).catch(() => {});
      if (file?.path) await fs.rm(file.path, { force: true }).catch(() => {});
      throw error;
    }
  }

  function withCreateLock(work) {
    const result = createTail.then(work);
    createTail = result.then(() => undefined, () => undefined);
    return result;
  }

  function createJob(options) {
    return withCreateLock(() => createJobInternal(options));
  }

  function retryJob({ file, jobId, requestedBy, requestedByUsername }) {
    return withCreateLock(async () => {
      const previous = await readJob(jobId);
      if (!previous) {
        if (file?.path) await fs.rm(file.path, { force: true }).catch(() => {});
        throw makeHttpError(404, 'IMPORT_NOT_FOUND', 'That bulk import job could not be found.');
      }
      if (previous.status !== 'completed_with_errors' || Number(previous.failedFiles) < 1) {
        if (file?.path) await fs.rm(file.path, { force: true }).catch(() => {});
        throw makeHttpError(409, 'IMPORT_NOT_RETRYABLE', 'Only imports with failed files can be retried.');
      }
      return createJobInternal({
        file,
        targetUserId: previous.targetUserId,
        requestedBy,
        requestedByUsername,
        retryOf: previous.id,
        expectedHash: previous.archiveSha256 || null,
        expectedArchiveName: previous.archiveName,
        expectedArchiveBytes: previous.archiveBytes
      });
    });
  }

  async function processJob(id) {
    const job = await readJob(id);
    if (!job) return;
    const zipPath = archivePath(id);
    try {
      try { await fs.access(zipPath); } catch { throw makeHttpError(410, 'IMPORT_ARCHIVE_MISSING', 'The ZIP needed to resume this import is no longer available. Upload it again to retry.'); }
      if (!Array.isArray(job.entries) || !job.entries.length) {
        const manifest = await inspectZip(zipPath);
        job.entries = manifest.entries;
        job.ignoredFiles = manifest.ignoredFiles;
      }
      for (const entry of job.entries) if (entry.status === 'processing') { entry.status = 'pending'; entry.error = null; }
      refreshCounts(job);
      job.status = 'processing';
      job.currentFile = null;
      job.updatedAt = new Date().toISOString();
      await writeJob(job);

      for (const entry of job.entries) {
        if (TERMINAL_FILE_STATES.has(entry.status)) continue;
        const tempPath = path.join(archiveDir, `${id}-${entry.index}-${crypto.randomUUID()}.work`);
        job.currentFile = entry.name;
        entry.status = 'processing';
        entry.attempts = (Number(entry.attempts) || 0) + 1;
        entry.error = null;
        job.updatedAt = new Date().toISOString();
        await writeJob(job);
        try {
          await execZipHelper('extract', zipPath, String(entry.index), tempPath);
          const stat = await fs.stat(tempPath);
          const limit = entry.kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
          if (stat.size !== entry.size || stat.size <= 0 || stat.size > limit) throw new Error('Invalid extracted media size.');
          const actualType = await detectFileType(tempPath);
          const expectedType = entry.kind === 'video' ? 'video/mp4' : 'image/jpeg';
          if (actualType !== expectedType) throw new Error('Invalid extracted media type.');
          const digest = await sha256File(tempPath);
          const outcome = entry.kind === 'video'
            ? await importVideo({ filePath: tempPath, job, digest, size: stat.size })
            : await importImage({ filePath: tempPath, job, digest, size: stat.size });
          entry.status = outcome;
        } catch (error) {
          entry.status = 'failed';
          entry.error = error.message === 'Invalid extracted media type.'
            ? 'The extracted file did not match its declared image or video type.'
            : error.message === 'Invalid extracted media size.'
              ? 'The ZIP entry could not be read. Upload the archive again if the problem continues.'
              : error.bulkImportZipFailure
                ? 'The ZIP entry could not be read. Upload the archive again if the problem continues.'
                : 'The media could not be stored. Check storage and database health, then retry the ZIP.';
          logger.warn(`[bulk-import] A media entry failed in job ${id} at index ${entry.index}.`);
        } finally {
          await fs.rm(tempPath, { force: true }).catch(() => {});
        }
        refreshCounts(job);
        job.currentFile = null;
        job.updatedAt = new Date().toISOString();
        await writeJob(job);
      }
      refreshCounts(job);
      job.status = job.failedFiles ? 'completed_with_errors' : 'completed';
      job.currentFile = null;
      job.updatedAt = new Date().toISOString();
      await writeJob(job);
    } catch (error) {
      job.status = 'failed';
      job.currentFile = null;
      job.message = 'Import failed. Re-upload the ZIP after checking service health.';
      logger.warn(`[bulk-import] Job ${id} stopped before completion (${error.code || error.name || 'ERROR'}).`);
    } finally {
      job.currentFile = null;
      job.updatedAt = new Date().toISOString();
      await fs.rm(zipPath, { force: true }).catch(() => {});
      await writeJob(job).catch(() => logger.error(`[bulk-import] Could not persist terminal state for job ${id}.`));
    }
  }

  async function drainQueue() {
    if (!workerStarted || workerPromise) return workerPromise;
    workerPromise = (async () => {
      while (queue.length) {
        const id = queue.shift();
        queuedIds.delete(id);
        if (runningIds.has(id)) continue;
        runningIds.add(id);
        try { await processJob(id); }
        catch { logger.warn(`[bulk-import] Job ${id} could not be processed.`); }
        finally { runningIds.delete(id); }
      }
    })().finally(() => {
      workerPromise = null;
      if (queue.length) void drainQueue();
    });
    return workerPromise;
  }

  async function start() {
    if (workerStarted) return;
    await ensureArchiveDir();
    await cleanupInterruptedFiles();
    workerStarted = true;
    for (const job of await listRawJobs()) {
      if (!['queued', 'processing'].includes(job.status)) continue;
      if (job.status === 'processing') {
        for (const entry of job.entries || []) if (entry.status === 'processing') { entry.status = 'pending'; entry.error = null; }
        job.status = 'queued';
        job.currentFile = null;
        refreshCounts(job);
        job.updatedAt = new Date().toISOString();
        await writeJob(job);
      }
      try {
        await fs.access(archivePath(job.id));
        queueJob(job.id);
      } catch {
        job.status = 'failed';
        job.currentFile = null;
        job.message = 'Import failed. The pending ZIP is missing; upload it again to retry.';
        job.updatedAt = new Date().toISOString();
        await writeJob(job);
      }
    }
    void drainQueue();
  }

  async function listJobs() {
    const jobs = await listRawJobs();
    return jobs.slice(-25).reverse().map(publicJob);
  }

  async function getJob(id) {
    const job = await readJob(id);
    return job ? publicJob(job) : null;
  }

  async function listUsers() {
    return prisma.user.findMany({
      orderBy: { username: 'asc' },
      take: 1000,
      select: { id: true, username: true, profile: { select: { displayName: true } } }
    });
  }

  return {
    createJob,
    retryJob,
    listJobs,
    getJob,
    listUsers,
    start,
    reserveUpload,
    hasActiveJob,
    archiveDir
  };
}

const bulkImportService = createBulkImportService();
module.exports = { ...bulkImportService, createBulkImportService };
