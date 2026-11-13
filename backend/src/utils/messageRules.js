const MESSAGE_REACTION_EMOJIS = Object.freeze(['❤️', '😂', '😮', '😢', '😡', '👍']);

function isSupportedReaction(emoji) {
  return typeof emoji === 'string' && MESSAGE_REACTION_EMOJIS.includes(emoji);
}

module.exports = { MESSAGE_REACTION_EMOJIS, isSupportedReaction };
