const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chunkText, computeStats } = require('../server/pipeline/chunker');
const { reciprocalRankFusion } = require('../server/retrieval/fusion');
const { recallAtK, mrr } = require('../server/evalService');
const { parseFrontmatter, extractWikilinks } = require('../server/pipeline/loader');

test('heading chunker splits by markdown headings', () => {
  const text = '# Title\n\nIntro text.\n\n## Section A\n\nContent A here.\n\n## Section B\n\nContent B here.';
  const chunks = chunkText(text, 'test', { strategy: 'heading', chunkSize: 500 });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.some((c) => c.headingPath.includes('Section A')));
});

test('semantic helpers split units and normalize groups', () => {
  const { splitUnits, normalizeGroups, packBySize, extractJsonObject } = require('../server/pipeline/chunker/semantic');
  const units = splitUnits('第一段内容。\n\n第二段内容。\n\n第三段内容。');
  assert.ok(units.length >= 2);
  assert.deepEqual(normalizeGroups([[0, 1], [2]], 3), [[0, 1], [2]]);
  assert.equal(normalizeGroups([[0, 2]], 3), null);
  assert.ok(packBySize(units, 20).length >= 1);
  assert.deepEqual(extractJsonObject('```json\n{"groups":[[0],[1]]}\n```').groups, [[0], [1]]);
});

test('recommend prefers heading for structured markdown notes', () => {
  const { recommendChunkStrategy } = require('../server/pipeline/chunker/recommend');
  const text = `# 笔记
## 一
内容一。
## 二
内容二。
## 三
内容三。
## 四
内容四。`;
  const result = recommendChunkStrategy(text);
  assert.equal(result.strategy, 'heading');
  assert.ok(result.reasons.length >= 1);
});

test('recommend prefers recursive when headings are weak but paragraphs exist', () => {
  const { recommendChunkStrategy } = require('../server/pipeline/chunker/recommend');
  const text = Array.from({ length: 6 }, (_, i) => `这是第 ${i + 1} 段，讲述一个完整主题的若干句子。`).join('\n\n');
  const result = recommendChunkStrategy(text);
  assert.equal(result.strategy, 'recursive');
});

test('joinApiUrl accepts base with or without /v1', () => {
  const { joinApiUrl } = require('../server/utils/apiUrl');
  assert.equal(
    joinApiUrl('https://api.siliconflow.cn', '/v1/embeddings'),
    'https://api.siliconflow.cn/v1/embeddings'
  );
  assert.equal(
    joinApiUrl('https://api.siliconflow.cn/v1', '/v1/embeddings'),
    'https://api.siliconflow.cn/v1/embeddings'
  );
});

test('computeStats returns count and avgLen', () => {
  const chunks = [{ text: 'abc' }, { text: 'abcdef' }];
  const stats = computeStats(chunks);
  assert.equal(stats.count, 2);
  assert.equal(stats.avgLen, 5);
});

test('RRF fusion merges ranked lists', () => {
  const a = [{ chunkId: 'c1', score: 0.9 }, { chunkId: 'c2', score: 0.8 }];
  const b = [{ chunkId: 'c2', score: 1.0 }, { chunkId: 'c3', score: 0.7 }];
  const fused = reciprocalRankFusion([
    a.map((x) => ({ ...x, sourceType: 'vector' })),
    b.map((x) => ({ ...x, sourceType: 'bm25' })),
  ]);
  assert.ok(fused.find((f) => f.chunkId === 'c2'));
});

test('weighted RRF boosts preferred list', () => {
  const vector = [{ chunkId: 'v1', score: 0.9, sourceType: 'vector' }];
  const bm25 = [{ chunkId: 'b1', score: 1.0, sourceType: 'bm25' }];
  const fused = reciprocalRankFusion([vector, bm25], 60, [1, 3]);
  assert.equal(fused[0].chunkId, 'b1');
});

test('eval metrics recallAtK and mrr', () => {
  assert.equal(recallAtK(['a', 'b', 'c'], ['b', 'd'], 3), 0.5);
  assert.equal(mrr(['a', 'b', 'c'], ['b']), 0.5);
  assert.equal(mrr(['a', 'b', 'c'], ['x']), 0);
});

const {
  normalizeDimensions,
  resolveCollectionEmbedding,
  formatEmbeddingLabel,
  embeddingConfigsMatch,
  assertEmbeddingMatch,
  buildEmbeddingOptions,
} = require('../server/embeddingConfig');

test('embeddingConfigsMatch detects model mismatch', () => {
  const collection = { model: 'BAAI/bge-m3', dim: 1024, dimensions: null };
  const requested = { model: 'BAAI/bge-large-zh-v1.5', dimensions: 1024 };
  assert.equal(embeddingConfigsMatch(collection, requested), false);
});

test('embeddingConfigsMatch allows same model', () => {
  const collection = { model: 'BAAI/bge-m3', dim: 1024, dimensions: null };
  const requested = { model: 'BAAI/bge-m3' };
  assert.equal(embeddingConfigsMatch(collection, requested), true);
});

test('assertEmbeddingMatch throws on mismatch', () => {
  const collection = { model: 'BAAI/bge-m3', dim: 1024, dimensions: null };
  assert.throws(
    () => assertEmbeddingMatch(collection, { model: 'other-model' }),
    /Embedding 模型不一致/
  );
});

test('resolveCollectionEmbedding reads new collection field', () => {
  const collection = {
    embedding: { model: 'BAAI/bge-m3', dimensions: null, dim: 1024 },
    stats: { model: 'old', dim: 512 },
  };
  const resolved = resolveCollectionEmbedding(collection, { model: 'BAAI/bge-m3', dim: 1024 });
  assert.equal(resolved.model, 'BAAI/bge-m3');
  assert.equal(resolved.dim, 1024);
});

test('resolveCollectionEmbedding falls back to stats for legacy collections', () => {
  const collection = { stats: { model: 'BAAI/bge-m3', dim: 1024 } };
  const resolved = resolveCollectionEmbedding(collection, { model: 'BAAI/bge-m3', dim: 1024 });
  assert.equal(resolved.model, 'BAAI/bge-m3');
});

test('parseFrontmatter extracts tags', () => {
  const content = '---\ntitle: Test\ntags: [rag, note]\n---\n\nBody [[Link]]';
  const parsed = parseFrontmatter(content);
  assert.deepEqual(parsed.tags, ['rag', 'note']);
  const links = extractWikilinks(parsed.body);
  assert.equal(links[0].target, 'Link');
});
