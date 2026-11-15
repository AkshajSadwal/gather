const { test } = require('node:test');
const assert = require('node:assert/strict');

test('conversation snapshot retains unique live messages only for the active conversation', async () => {
  const { mergeConversationMessages } = await import('../frontend/lib/messageList.mjs');
  const snapshot = [{ id: 'a', conversationId: 'one' }];
  const live = [{ id: 'a', conversationId: 'one' }, { id: 'b', conversationId: 'one' }, { id: 'b', conversationId: 'one' }, { id: 'c', conversationId: 'two' }];
  assert.deepEqual(mergeConversationMessages(snapshot, live, 'one').map((item) => item.id), ['a', 'b']);
});
