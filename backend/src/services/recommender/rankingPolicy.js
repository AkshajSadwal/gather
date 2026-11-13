function isReelEligible(reel, { userId, hiddenIds, followedIds, personalizationEnabled, affinity }) {
  if (hiddenIds.has(reel.authorId) || reel.post?.archivedAt) return false;
  const visibility = reel.author?.profile?.visibility;
  if (visibility === 'PRIVATE' && reel.authorId !== userId && !followedIds.has(reel.authorId)) return false;
  return !personalizationEnabled || (affinity.get(reel.authorId) ?? 0) > -3;
}

function applyModelRanking(candidatePool, ranked) {
  if (ranked?.status !== 'READY' || !Array.isArray(ranked.items)) return null;
  const poolById = new Map(candidatePool.map((candidate) => [candidate.reelId, candidate]));
  const seen = new Set();
  const trusted = [];
  for (const item of ranked.items) {
    const original = poolById.get(item?.reelId);
    if (!original || seen.has(item.reelId) || !Number.isFinite(item.rankingScore)) return null;
    seen.add(item.reelId);
    trusted.push({
      ...original,
      retrievalScore: Number.isFinite(item.retrievalScore) ? item.retrievalScore : null,
      rankingScore: item.rankingScore
    });
  }
  return trusted.length === candidatePool.length ? trusted : null;
}

module.exports = { isReelEligible, applyModelRanking };
