process.env.AUTH_SECRET ||= 'bulk-import-test-secret-not-for-production';
process.env.FRONTEND_URL ||= 'http://localhost:3000';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const backendRequire = createRequire(path.resolve(__dirname, '../backend/package.json'));
const { HttpError } = require('../backend/src/utils/http');
const { createBulkImportsRouter, requireSameOrigin } = require('../backend/src/routes/bulkImports');
const { createRequireAdmin } = require('../backend/src/middleware/admin');
const { createBulkImportService } = require('../backend/src/services/bulkImportService');

const pythonBinary = process.platform === 'win32' ? 'python' : 'python3';
const pythonAvailable = spawnSync(pythonBinary, ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;
const zipHelper = path.resolve(__dirname, '../backend/scripts/bulk-import-zip.py');
const adminId = 'cuid_admin_123';
const targetId = 'cuid_target_123';
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
const mp4Bytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);

async function makeTempDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'gather-bulk-import-test-'));
}

async function makeUpload(directory, name = 'photos.zip') {
  const filename = path.join(directory, `upload-${crypto.randomUUID()}.incoming`);
  const bytes = Buffer.from('PK\x03\x04test-fixture');
  await fs.writeFile(filename, bytes, { mode: 0o600 });
  return { path: filename, originalname: name, size: bytes.length };
}

function createFakeDatabase() {
  const state = { posts: [], reels: [], postMedia: [], reelMedia: [] };
  let nextId = 0;
  const database = {
    user: {
      findUnique: async ({ where }) => where.id === targetId ? { id: targetId, username: 'gather_target' } : null,
      findMany: async () => [{ id: targetId, username: 'gather_target', image: null, profile: null }]
    },
    postMedia: {
      findFirst: async ({ where }) => state.postMedia.find((item) => item.objectKey === where.objectKey) || null
    },
    reelMedia: {
      findFirst: async ({ where }) => state.reelMedia.find((item) => item.objectKey === where.objectKey) || null
    },
    post: {
      create: async ({ data }) => {
        const id = `post-${++nextId}`;
        state.posts.push({ id, authorId: data.authorId, caption: data.caption });
        state.postMedia.push({ id: `post-media-${nextId}`, postId: id, ...data.media.create });
        return { id };
      }
    },
    reel: {
      create: async ({ data }) => {
        const id = `reel-${++nextId}`;
        state.reels.push({ id, authorId: data.authorId, postId: data.postId, caption: data.caption });
        state.reelMedia.push({ id: `reel-media-${nextId}`, reelId: id, ...data.media.create });
        return { id };
      }
    },
    $transaction: async (callback) => callback(database)
  };
  return { database, state };
}

function fakeZipHelper() {
  const entries = [
    { index: 0, name: 'photos/summer.jpg', size: jpegBytes.length, kind: 'image' },
    { index: 1, name: 'videos/clip.mp4', size: mp4Bytes.length, kind: 'video' }
  ];
  return async (action, _archive, index, destination) => {
    if (action === 'list') return JSON.stringify({ files: entries, ignoredCount: 1 });
    await fs.writeFile(destination, Number(index) === 0 ? jpegBytes : mp4Bytes, { flag: 'wx', mode: 0o600 });
    return '{}';
  };
}

async function waitForJob(service, id) {
  let lastJob = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    lastJob = await service.getJob(id);
    if (lastJob && !['queued', 'processing'].includes(lastJob.status)) return lastJob;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Bulk import worker did not finish the fixture job: ${JSON.stringify(lastJob)}`);
}

test('bulk import routes enforce authentication, admin access, and same-origin multipart writes', async (t) => {
  const previousAdmins = process.env.ADMIN_USERNAMES;
  process.env.ADMIN_USERNAMES = 'trusted_admin';
  t.after(() => {
    if (previousAdmins === undefined) delete process.env.ADMIN_USERNAMES;
    else process.env.ADMIN_USERNAMES = previousAdmins;
  });

  const fakeAuth = (req, _res, next) => {
    const username = req.headers['x-test-user'];
    if (!username) return next(new HttpError(401, 'UNAUTHENTICATED', 'Please sign in to continue.'));
    req.user = { id: username === 'trusted_admin' ? adminId : 'cuid_member_123', username };
    next();
  };
  const databaseAdmin = createRequireAdmin(async (id) => id === adminId ? { username: 'trusted_admin' } : id === 'cuid_member_123' ? { username: 'ordinary_member' } : null);
  const router = createBulkImportsRouter({ auth: fakeAuth, admin: databaseAdmin, service: {} });
  const routes = router.stack.filter((layer) => layer.route).map((layer) => layer.route);
  const routeFor = (pathValue, method) => routes.find((route) => route.path === pathValue && route.methods[method]);
  for (const [routePath, method] of [['/users', 'get'], ['/', 'get'], ['/', 'post'], ['/:id/retry', 'post'], ['/:id', 'get']]) {
    const route = routeFor(routePath, method);
    assert.ok(route, `${method.toUpperCase()} ${routePath} should be registered`);
    assert.equal(route.stack[0].handle, fakeAuth, `${method.toUpperCase()} ${routePath} must authenticate first`);
    assert.equal(route.stack[1].handle, databaseAdmin, `${method.toUpperCase()} ${routePath} must authorize admins second`);
  }

  const invoke = (middleware, req) => new Promise((resolve) => {
    middleware(req, {}, (error) => resolve(error || null));
  });
  const unauthenticated = { headers: {} };
  assert.equal((await invoke(fakeAuth, unauthenticated))?.status, 401);
  const member = { headers: { 'x-test-user': 'ordinary_member' } };
  assert.equal(await invoke(fakeAuth, member), null);
  assert.equal((await invoke(databaseAdmin, member))?.status, 403);
  const admin = { headers: { 'x-test-user': 'trusted_admin' } };
  assert.equal(await invoke(fakeAuth, admin), null);
  assert.equal(await invoke(databaseAdmin, admin), null);
  assert.equal(admin.user.username, 'trusted_admin');

  const staleAdminClaim = { user: { id: 'cuid_member_123', username: 'trusted_admin' } };
  assert.equal((await invoke(databaseAdmin, staleAdminClaim))?.status, 403);

  const deniedOrigin = await new Promise((resolve) => {
    requireSameOrigin({ get: () => 'https://attacker.example' }, {}, (error) => resolve(error || null));
  });
  assert.equal(deniedOrigin?.code, 'ORIGIN_FORBIDDEN');
  const allowedOrigin = await new Promise((resolve) => {
    requireSameOrigin({ get: () => 'http://localhost:3000' }, {}, (error) => resolve(error || null));
  });
  assert.equal(allowedOrigin, null);
  const noOrigin = await new Promise((resolve) => {
    requireSameOrigin({ get: () => undefined }, {}, (error) => resolve(error || null));
  });
  assert.equal(noOrigin, null);
});

test('persistent imports resume after restart, preserve OCI media references, and retry idempotently', async (t) => {
  const directory = await makeTempDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { database, state } = createFakeDatabase();
  const storedObjects = new Map();
  const warnings = [];
  let failFirstImage = true;
  const storageAdapter = {
    putFile: async (_filename, objectKey, contentType) => {
      if (objectKey.includes('/posts/') && failFirstImage) {
        storedObjects.set(objectKey, contentType);
        failFirstImage = false;
        throw new Error('simulated storage timeout after object write');
      }
      storedObjects.set(objectKey, contentType);
    },
    deleteObject: async (objectKey) => { storedObjects.delete(objectKey); }
  };
  const dependencies = {
    prisma: database,
    uploadDir: directory,
    storage: { bucket: 'gather-media' },
    putFile: storageAdapter.putFile,
    deleteObject: storageAdapter.deleteObject,
    runZipHelper: fakeZipHelper(),
    logger: { warn: (message) => warnings.push(message), error: (message) => warnings.push(message) }
  };

  const beforeRestart = createBulkImportService(dependencies);
  const firstJob = await beforeRestart.createJob({ file: await makeUpload(directory), targetUserId: targetId, requestedBy: adminId, requestedByUsername: 'trusted_admin' });
  assert.equal(firstJob.status, 'queued');
  assert.equal(firstJob.requestedBy, adminId);
  const persistedPath = path.join(beforeRestart.archiveDir, `${firstJob.id}.json`);
  const interruptedState = JSON.parse(await fs.readFile(persistedPath, 'utf8'));
  interruptedState.status = 'processing';
  interruptedState.entries[0].status = 'processing';
  await fs.writeFile(persistedPath, JSON.stringify(interruptedState));

  const afterRestart = createBulkImportService(dependencies);
  await afterRestart.start();
  const partiallyFailed = await waitForJob(afterRestart, firstJob.id);
  assert.equal(partiallyFailed.status, 'completed_with_errors', JSON.stringify({ job: partiallyFailed, warnings }));
  assert.equal(partiallyFailed.createdReels, 1);
  assert.equal(partiallyFailed.failedFiles, 1);
  assert.equal(partiallyFailed.errors[0].message.includes('simulated storage timeout'), false);
  assert.equal([...storedObjects.keys()].some((key) => key.includes('/posts/')), false);

  const retried = await afterRestart.retryJob({ file: await makeUpload(directory), jobId: firstJob.id, requestedBy: adminId, requestedByUsername: 'trusted_admin' });
  assert.equal(retried.retryOf, firstJob.id);
  const retryResult = await waitForJob(afterRestart, retried.id);
  assert.equal(retryResult.status, 'completed', JSON.stringify({ job: retryResult, warnings }));
  assert.equal(retryResult.createdPosts, 1);
  assert.equal(retryResult.skippedFiles, 1);
  assert.equal(state.posts.length, 2);
  assert.equal(state.reels.length, 1);
  const imageMedia = state.postMedia.find((media) => media.type === 'IMAGE');
  const reelPostMedia = state.postMedia.find((media) => media.type === 'VIDEO');
  assert.equal(imageMedia.url, `s3://gather-media/${imageMedia.objectKey}`);
  assert.match(imageMedia.objectKey, /^bulk-imports\/cuid_target_123\/posts\/[a-f0-9]{64}\.jpg$/);
  assert.match(reelPostMedia.objectKey, /^bulk-imports\/cuid_target_123\/reels\/[a-f0-9]{64}\.mp4$/);
  assert.equal(state.reelMedia[0].url, `s3://gather-media/${state.reelMedia[0].objectKey}`);
  assert.match(state.reelMedia[0].objectKey, /^bulk-imports\/cuid_target_123\/reels\/[a-f0-9]{64}\.mp4$/);

  const duplicate = await afterRestart.createJob({ file: await makeUpload(directory), targetUserId: targetId, requestedBy: adminId, requestedByUsername: 'trusted_admin' });
  const duplicateResult = await waitForJob(afterRestart, duplicate.id);
  assert.equal(duplicateResult.status, 'completed', JSON.stringify({ job: duplicateResult, warnings }));
  assert.equal(duplicateResult.skippedFiles, 2);
  assert.equal(state.posts.length, 2);
  assert.equal(state.reels.length, 1);
});

test('bulk import validates target ownership and serializes active jobs', async (t) => {
  const directory = await makeTempDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const { database } = createFakeDatabase();
  const service = createBulkImportService({
    prisma: database,
    uploadDir: directory,
    storage: { bucket: 'gather-media' },
    putFile: async () => {},
    deleteObject: async () => {},
    runZipHelper: async (action) => action === 'list' ? JSON.stringify({ files: [{ index: 0, name: 'photo.jpg', size: jpegBytes.length, kind: 'image' }] }) : '{}',
    logger: { warn() {}, error() {} }
  });
  await assert.rejects(service.createJob({ file: await makeUpload(directory), targetUserId: 'missing-user', requestedBy: adminId }), (error) => error.code === 'TARGET_USER_NOT_FOUND');
  const [first, second] = await Promise.allSettled([
    service.createJob({ file: await makeUpload(directory), targetUserId: targetId, requestedBy: adminId }),
    service.createJob({ file: await makeUpload(directory), targetUserId: targetId, requestedBy: adminId })
  ]);
  assert.equal([first, second].filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = [first, second].find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'BULK_IMPORT_BUSY');
});

test('startup cleanup removes stale partial uploads and archive files without job records', async (t) => {
  const directory = await makeTempDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const archiveDir = path.join(directory, '.bulk-imports');
  await fs.mkdir(archiveDir, { recursive: true });
  const orphanZip = path.join(archiveDir, `${crypto.randomUUID()}.zip`);
  const interruptedUpload = path.join(archiveDir, `${crypto.randomUUID()}.incoming`);
  await fs.writeFile(orphanZip, 'stale archive');
  await fs.writeFile(interruptedUpload, 'partial upload');
  const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.utimes(orphanZip, stale, stale);
  await fs.utimes(interruptedUpload, stale, stale);
  const { database } = createFakeDatabase();
  const service = createBulkImportService({ prisma: database, uploadDir: directory, runZipHelper: fakeZipHelper(), logger: { warn() {}, error() {} } });
  await service.start();
  assert.equal(await fs.stat(orphanZip).then(() => true, () => false), false);
  assert.equal(await fs.stat(interruptedUpload).then(() => true, () => false), false);
});

test('ZIP helper accepts safe media and rejects traversal, symlinks, and high-ratio entries', { skip: !pythonAvailable && 'Python is unavailable in this environment.' }, async (t) => {
  const directory = await makeTempDirectory();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const createZip = (filename, mode) => {
    const script = `import json,stat,sys,zipfile\npath,mode=sys.argv[1:3]\nwith zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:\n if mode=='valid': z.writestr('photos/summer.jpeg',bytes.fromhex('ffd8ff0102'))\n if mode=='traversal': z.writestr('../outside.jpg',bytes.fromhex('ffd8ff0102'))\n if mode=='symlink':\n  i=zipfile.ZipInfo('photos/link.jpg'); i.external_attr=(stat.S_IFLNK|0o777)<<16; z.writestr(i,b'../secret')\n if mode=='ratio': z.writestr('large.txt',b'A'*(4*1024*1024))\n`;
    const result = spawnSync(pythonBinary, ['-c', script, path.join(directory, filename), mode], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    return path.join(directory, filename);
  };
  const runHelper = (...args) => spawnSync(pythonBinary, [zipHelper, ...args], { encoding: 'utf8', windowsHide: true });

  const validArchive = createZip('valid.zip', 'valid');
  const listed = runHelper('list', validArchive);
  assert.equal(listed.status, 0, listed.stderr);
  const manifest = JSON.parse(listed.stdout);
  assert.deepEqual(manifest.files.map(({ name, kind }) => ({ name, kind })), [{ name: 'summer.jpeg', kind: 'image' }]);
  const extracted = path.join(directory, 'out', 'safe-media.bin');
  assert.equal(runHelper('extract', validArchive, '0', extracted).status, 0);
  assert.deepEqual(await fs.readFile(extracted), Buffer.from([0xff, 0xd8, 0xff, 0x01, 0x02]));

  for (const mode of ['traversal', 'symlink', 'ratio']) {
    const invalid = createZip(`${mode}.zip`, mode);
    assert.notEqual(runHelper('list', invalid).status, 0, `${mode} archive should be rejected`);
  }
  assert.equal(await fs.stat(path.join(directory, 'outside.jpg')).then(() => true, () => false), false);
});
