const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMediaController } = require('../backend/src/controllers/mediaController');
const { createMediaAuthorizer } = require('../backend/src/middleware/mediaAccess');

const reference = `s3://gather-media/bulk-imports/owner-1/posts/${'a'.repeat(64)}.jpg`;

function fakePrisma(post) {
  return {
    postMedia: { findMany: async ({ where }) => where.url === reference && post ? [{ post }] : [] },
    storyMedia: { findMany: async () => [] },
    reelMedia: { findMany: async () => [] },
    user: { findFirst: async () => null },
    follow: { findUnique: async () => null }
  };
}

function postWithVisibility(visibility) {
  return {
    id: 'post-1', authorId: 'owner-1', archivedAt: null,
    author: { profile: { visibility } }
  };
}

function responseRecorder() {
  return {
    statusCode: null,
    location: null,
    redirect(status, location) { this.statusCode = status; this.location = location; return this; }
  };
}

test('authorized imported S3 media is looked up by canonical URL and redirects to a signed URL', async () => {
  const authorize = createMediaAuthorizer({ db: fakePrisma(postWithVisibility('PUBLIC')), blockedBetween: async () => false });
  let signedReference;
  const controller = createMediaController({
    getUser: async () => ({ id: 'viewer-1' }),
    authorize,
    signUrl: async (value) => { signedReference = value; return 'https://oci.example.test/signed-object'; }
  });
  const response = responseRecorder();

  await controller.serve({ query: { key: reference }, headers: { cookie: 'session-cookie' } }, response);

  assert.equal(signedReference, reference);
  assert.equal(response.statusCode, 302);
  assert.equal(response.location, 'https://oci.example.test/signed-object');
});

test('S3 media redirects remain denied for private accounts and blocked viewers', async () => {
  const privateAuthorize = createMediaAuthorizer({ db: fakePrisma(postWithVisibility('PRIVATE')), blockedBetween: async () => false });
  const privateController = createMediaController({ getUser: async () => ({ id: 'viewer-1' }), authorize: privateAuthorize, signUrl: async () => assert.fail('private media must not be signed') });
  await assert.rejects(
    privateController.serve({ query: { key: reference }, headers: {} }, responseRecorder()),
    (error) => error.status === 403 && error.code === 'MEDIA_PRIVATE'
  );

  const blockedAuthorize = createMediaAuthorizer({ db: fakePrisma(postWithVisibility('PUBLIC')), blockedBetween: async () => true });
  const blockedController = createMediaController({ getUser: async () => ({ id: 'viewer-1' }), authorize: blockedAuthorize, signUrl: async () => assert.fail('blocked media must not be signed') });
  await assert.rejects(
    blockedController.serve({ query: { key: reference }, headers: {} }, responseRecorder()),
    (error) => error.status === 403 && error.code === 'MEDIA_PRIVATE'
  );
});
