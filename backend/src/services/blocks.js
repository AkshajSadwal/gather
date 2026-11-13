const { getBlockState, isBlockedBetween, blockedIdsFor } = require('./relations');

async function getBlockedUserIds(userId) {
  return blockedIdsFor(userId);
}

module.exports = { getBlockState, isBlockedBetween, getBlockedUserIds };
