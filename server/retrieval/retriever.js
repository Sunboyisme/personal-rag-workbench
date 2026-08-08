const fs = require('fs');
const path = require('path');
const { dataDir } = require('../config');
const { readSubJson, getCollection } = require('../store');
const { loadVectorSet } = require('../pipeline/indexer');
const { BM25Index } = require('./bm25');
const { searchVectors } = require('./vectorStore');
const { reciprocalRankFusion } = require('./fusion');
const { rerank } = require('./rerank');
const { embedQuery } = require('../pipeline/embedder');
const { rewriteQuery } = require('./queryRewrite');
const {
  resolveCollectionEmbedding,
  assertEmbeddingMatch,
  buildEmbeddingOptions,
  formatEmbeddingLabel,
} = require('../embeddingConfig');

function loadBm25(vectorSetId) {
  const bm25Path = path.join(dataDir, 'vectors', `${vectorSetId}.bm25.json`);
  if (!fs.existsSync(bm25Path)) return null;
  return BM25Index.deserialize(JSON.parse(fs.readFileSync(bm25Path, 'utf8')));
}

function rankMap(items, scoreKey = 'score') {
  const sorted = [...items].sort((a, b) => (b[scoreKey] || 0) - (a[scoreKey] || 0));
  const map = new Map();
  sorted.forEach((item, idx) => map.set(item.chunkId, idx + 1));
  return map;
}

function resolveThresholdMode(config, useRerank) {
  const mode = String(config.thresholdMode || '').toLowerCase();
  if (mode === 'off' || mode === 'none' || mode === 'disabled') return 'off';
  if (mode === 'vector' || mode === 'rerank') return mode;
  // 默认：开了 Rerank 就按 Rerank 分过滤，否则按向量分
  return useRerank ? 'rerank' : 'vector';
}

function resolveActiveThreshold(config, thresholdMode) {
  if (thresholdMode === 'off') return null;
  if (thresholdMode === 'rerank') {
    const value = config.rerankThreshold ?? config.similarityThreshold;
    return Number(value ?? 0.3);
  }
  const value = config.vectorThreshold ?? config.similarityThreshold;
  return Number(value ?? 0.4);
}

function thresholdScoreOf(candidate, mode) {
  if (mode === 'rerank') return candidate.rerankScore ?? candidate.vectorScore ?? null;
  if (mode === 'vector') return candidate.vectorScore ?? null;
  return null;
}

async function retrieve(query, collectionId, config = {}) {
  const collection = getCollection(collectionId);
  if (!collection) throw new Error(`Collection 不存在: ${collectionId}`);

  const chunkSet = readSubJson('chunksets', collection.chunkSetId);
  const vectorData = loadVectorSet(collection.vectorSetId);
  const bm25 = loadBm25(collection.vectorSetId);
  if (!chunkSet || !vectorData) throw new Error('Collection 数据不完整');

  const collectionEmbedding = resolveCollectionEmbedding(collection, vectorData.meta);
  assertEmbeddingMatch(collectionEmbedding, config.embedding);
  const embedOptions = buildEmbeddingOptions(collectionEmbedding);

  const chunkMap = new Map(chunkSet.chunks.map((c) => [c.id, c]));
  const topK = Number(config.topK || 20);
  const useBm25 = config.useBm25 !== false;
  const useRerank = config.useRerank !== false;
  const finalTopK = Number(config.finalTopK || 5);
  const rrfK = Number(config.rrfK || 60);
  const vectorWeight = Number(config.vectorWeight ?? 1);
  const bm25Weight = Number(config.bm25Weight ?? 1);
  const rerankTopN = Math.max(1, Number(config.rerankTopN || topK));
  const minVectorForRerank = config.minVectorScoreForRerank;
  const minVectorScoreForRerank =
    minVectorForRerank === '' || minVectorForRerank == null
      ? null
      : Number(minVectorForRerank);
  const thresholdMode = resolveThresholdMode(config, useRerank);
  const vectorThreshold = Number(
    config.vectorThreshold ?? config.similarityThreshold ?? 0.4
  );
  const rerankThreshold = Number(
    config.rerankThreshold ?? config.similarityThreshold ?? 0.3
  );
  const threshold = resolveActiveThreshold(
    { ...config, vectorThreshold, rerankThreshold },
    thresholdMode
  );
  const queryRewriteMode = config.queryRewrite || 'off';

  const timings = {};
  const tRewrite = Date.now();
  let rewritten;
  if (config._prewrittenQuery) {
    rewritten = config._prewrittenQuery;
    timings.rewriteMs = 0;
  } else {
    try {
      rewritten = await rewriteQuery(query, queryRewriteMode, {
        model: config.rewriteModel || config.chatModel,
      });
    } catch (error) {
      // 改写失败不阻断检索
      rewritten = {
        mode: queryRewriteMode,
        originalQuery: query,
        embedText: query,
        bm25Text: query,
        rerankQuery: query,
        rewriteText: null,
        error: error.message,
      };
    }
    timings.rewriteMs = Date.now() - tRewrite;
  }

  const t0 = Date.now();
  const queryVector = await embedQuery(rewritten.embedText || query, embedOptions);
  timings.embedMs = Date.now() - t0;

  const t1 = Date.now();
  const vectorHits = searchVectors(queryVector, vectorData.vectors, topK).map((hit) => ({
    chunkId: vectorData.meta.chunkIds[hit.index],
    score: hit.score,
    sourceType: 'vector',
  }));
  timings.vectorMs = Date.now() - t1;

  const t2 = Date.now();
  const bm25Hits = useBm25 && bm25
    ? bm25.score(rewritten.bm25Text || query).slice(0, topK).map((hit) => ({
        chunkId: hit.chunkId,
        score: hit.score,
        sourceType: 'bm25',
      }))
    : [];
  timings.bm25Ms = Date.now() - t2;

  const t3 = Date.now();
  const lists = [];
  const weights = [];
  if (vectorHits.length) {
    lists.push(vectorHits);
    weights.push(vectorWeight);
  }
  if (bm25Hits.length) {
    lists.push(bm25Hits);
    weights.push(bm25Weight);
  }
  const fused = reciprocalRankFusion(lists, rrfK, weights).slice(0, topK);
  timings.fusionMs = Date.now() - t3;

  const vectorScoreMap = new Map(vectorHits.map((h) => [h.chunkId, h.score]));
  const bm25ScoreMap = new Map(bm25Hits.map((h) => [h.chunkId, h.score]));
  const fusedScoreMap = new Map(fused.map((f) => [f.chunkId, f.rrfScore]));

  const fusedDocs = fused.map((f) => {
    const chunk = chunkMap.get(f.chunkId);
    return {
      chunkId: f.chunkId,
      text: chunk?.text || '',
      headingPath: chunk?.headingPath || [],
      parentId: chunk?.parentId || null,
      rrfScore: f.rrfScore,
      vectorScore: vectorScoreMap.get(f.chunkId) ?? null,
    };
  });

  let rerankPool = fusedDocs;
  if (minVectorScoreForRerank != null && !Number.isNaN(minVectorScoreForRerank)) {
    rerankPool = rerankPool.filter(
      (d) => d.vectorScore == null || d.vectorScore >= minVectorScoreForRerank
    );
  }
  rerankPool = rerankPool.slice(0, Math.min(rerankTopN, rerankPool.length));

  const t4 = Date.now();
  const rerankScoreMap = new Map();
  const rerankedIds = new Set();
  if (useRerank && rerankPool.length) {
    const rr = await rerank(rewritten.rerankQuery || query, rerankPool, {
      topN: rerankPool.length,
      ...(config.rerank || {}),
    });
    rr.forEach((r) => {
      const doc = rerankPool[r.index];
      if (!doc) return;
      rerankScoreMap.set(doc.chunkId, r.relevance_score);
      rerankedIds.add(doc.chunkId);
    });
  } else if (!useRerank) {
    fusedDocs.forEach((d) => rerankScoreMap.set(d.chunkId, d.rrfScore));
  }
  timings.rerankMs = Date.now() - t4;

  // 最终排序分：优先 rerank；未进精排的用 rrf 作为弱分（略降权）
  const finalScoreMap = new Map();
  fusedDocs.forEach((d) => {
    if (rerankScoreMap.has(d.chunkId)) {
      finalScoreMap.set(d.chunkId, rerankScoreMap.get(d.chunkId));
    } else {
      finalScoreMap.set(d.chunkId, (d.rrfScore || 0) * 0.001);
    }
  });

  const vectorRank = rankMap(vectorHits);
  const bm25Rank = rankMap(bm25Hits);
  const fusedRank = rankMap(fused, 'rrfScore');
  const finalRanked = [...finalScoreMap.entries()]
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score);
  const finalRank = new Map();
  finalRanked.forEach((item, idx) => finalRank.set(item.chunkId, idx + 1));

  const allChunkIds = new Set([
    ...vectorHits.map((h) => h.chunkId),
    ...bm25Hits.map((h) => h.chunkId),
  ]);

  const candidates = [...allChunkIds].map((chunkId) => {
    const chunk = chunkMap.get(chunkId);
    const rerankScore = rerankScoreMap.has(chunkId) ? rerankScoreMap.get(chunkId) : null;
    const vectorScore = vectorScoreMap.get(chunkId) ?? null;
    const rrfScore = fusedScoreMap.get(chunkId) ?? null;
    const finalPos = finalRank.get(chunkId) || null;

    let status = 'out_of_topk';
    let droppedBy = null;
    const probe = {
      vectorScore,
      rerankScore: rerankScore ?? (useRerank ? null : rrfScore),
    };
    const gateScore = thresholdScoreOf(probe, thresholdMode);

    if (finalPos && finalPos <= finalTopK) {
      if (thresholdMode !== 'off' && threshold != null && gateScore != null && gateScore < threshold) {
        status = 'below_threshold';
        droppedBy = `threshold:${thresholdMode}(${threshold})`;
      } else if (thresholdMode !== 'off' && threshold != null && gateScore == null) {
        status = 'below_threshold';
        droppedBy = `threshold:${thresholdMode}(missing_score)`;
      } else {
        status = 'selected';
      }
    } else if (thresholdMode !== 'off' && threshold != null && gateScore != null && gateScore < threshold) {
      status = 'below_threshold';
      droppedBy = `threshold:${thresholdMode}(${threshold})`;
    } else if (useRerank && fusedScoreMap.has(chunkId) && !rerankedIds.has(chunkId) && finalPos && finalPos <= topK) {
      // 未进入精排池，但仍在融合候选中
      droppedBy = droppedBy || 'not_in_rerank_pool';
    }

    return {
      chunkId,
      text: chunk?.text?.slice(0, 200) || '',
      headingPath: chunk?.headingPath || [],
      sourceId: chunk?.sourceId,
      vectorScore,
      bm25Score: bm25ScoreMap.get(chunkId) ?? null,
      rrfScore,
      rerankScore,
      ranks: {
        vector: vectorRank.get(chunkId) || null,
        bm25: bm25Rank.get(chunkId) || null,
        fused: fusedRank.get(chunkId) || null,
        final: finalPos,
      },
      status,
      droppedBy,
      inRerankPool: rerankedIds.has(chunkId) || (!useRerank && fusedScoreMap.has(chunkId)),
      _scoreForSort: finalScoreMap.get(chunkId) ?? gateScore ?? 0,
    };
  });

  candidates.sort((a, b) => (b._scoreForSort || 0) - (a._scoreForSort || 0));

  const selected = [];
  const seen = new Set();
  for (const c of candidates) {
    if (c.status !== 'selected') continue;
    const chunk = chunkMap.get(c.chunkId);
    if (!chunk) continue;
    const useChunk = chunk.parentId ? chunkMap.get(chunk.parentId) || chunk : chunk;
    if (seen.has(useChunk.id)) {
      c.status = 'deduped';
      c.droppedBy = 'dedup';
      continue;
    }
    seen.add(useChunk.id);
    selected.push(useChunk);
    if (selected.length >= finalTopK) break;
  }

  return {
    query,
    collectionId,
    config: {
      ...config,
      topK,
      finalTopK,
      vectorThreshold,
      rerankThreshold,
      similarityThreshold: threshold,
      activeThreshold: threshold,
      thresholdMode,
      useBm25,
      useRerank,
      rrfK,
      vectorWeight,
      bm25Weight,
      rerankTopN,
      minVectorScoreForRerank,
      queryRewrite: rewritten.mode,
    },
    queryRewrite: rewritten,
    embeddingUsed: formatEmbeddingLabel(collectionEmbedding),
    candidates: candidates.map(({ _scoreForSort, ...rest }) => rest),
    selectedChunks: selected,
    timings,
    rerankPoolSize: rerankPool.length,
  };
}

module.exports = { retrieve, loadBm25 };
