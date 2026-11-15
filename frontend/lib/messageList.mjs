export function mergeConversationMessages(snapshot, live, conversationId) {
  const result = [...snapshot];
  const seen = new Set(result.map((message) => message.id));
  for (const message of live) {
    if (message.conversationId === conversationId && !seen.has(message.id)) {
      result.push(message);
      seen.add(message.id);
    }
  }
  return result;
}
