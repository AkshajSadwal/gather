const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  feed,
  explore,
  setPostFeedDependenciesForTests,
  resetPostFeedDependenciesForTests
} = require('../backend/src/controllers/postController');

function setup() {
  const queries = [];
  const fakePrisma = {
    follow: { findMany: async () => [{ followedId: 'followed-user' }] },
    post: {
      findMany: async ({ where }) => { queries.push(where); return []; },
      count: async () => 0
    }
  };
  setPostFeedDependenciesForTests({
    prisma: fakePrisma,
    getBlockedUserIds: async () => ['blocked-user'],
    mutedIdsFor: async () => ['muted-user']
  });
  return queries;
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('home feed excludes blocked and muted authors', async () => {
  const queries = setup();
  try {
    await feed({ user: { id: 'viewer' }, query: {} }, response());
    assert.deepEqual(queries[0].authorId.notIn, ['blocked-user', 'muted-user']);
  } finally { resetPostFeedDependenciesForTests(); }
});

test('Explore excludes blocked and muted authors', async () => {
  const queries = setup();
  try {
    await explore({ user: { id: 'viewer' }, query: {} }, response());
    assert.deepEqual(queries[0].authorId.notIn, ['blocked-user', 'muted-user']);
  } finally { resetPostFeedDependenciesForTests(); }
});
