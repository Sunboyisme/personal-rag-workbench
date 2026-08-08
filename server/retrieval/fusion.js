/**
 * Weighted Reciprocal Rank Fusion.
 * @param {Array<Array>} lists ranked lists with { chunkId|id, score?, sourceType? }
 * @param {number} k RRF constant
 * @param {number[]} weights per-list weights (default 1)
 */
function reciprocalRankFusion(lists, k = 60, weights = []) {
  const scores = new Map();
  lists.forEach((list, listIndex) => {
    const weight = Number(weights[listIndex] ?? 1);
    if (!list?.length || weight === 0) return;
    list.forEach((item, rank) => {
      const id = item.chunkId || item.id;
      const prev = scores.get(id) || { chunkId: id, rrfScore: 0, sources: [] };
      prev.rrfScore += weight / (k + rank + 1);
      prev.sources.push({
        type: item.sourceType,
        rank: rank + 1,
        score: item.score,
        weight,
      });
      scores.set(id, prev);
    });
  });
  return [...scores.values()].sort((a, b) => b.rrfScore - a.rrfScore);
}

module.exports = { reciprocalRankFusion };
