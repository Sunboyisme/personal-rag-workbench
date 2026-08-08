const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { dataDir } = require('../config');
const {
  readSubJson,
  writeSubJson,
  getCollections,
  saveCollections,
} = require('../store');
const { embedChunks } = require('./embedder');
const { BM25Index } = require('../retrieval/bm25');
const { normalize } = require('../retrieval/vectorStore');
const { normalizeDimensions } = require('../embeddingConfig');

function vectorBinPath(id) {
  return path.join(dataDir, 'vectors', `${id}.bin`);
}

function vectorMetaPath(id) {
  return path.join(dataDir, 'vectors', `${id}.meta.json`);
}

function saveVectorSet(vectorSet, vectors) {
  const dim = vectorSet.dim;
  const buffer = Buffer.alloc(vectors.length * dim * 4);
  for (let i = 0; i < vectors.length; i += 1) {
    const normalized = normalize(vectors[i]);
    for (let j = 0; j < dim; j += 1) {
      buffer.writeFloatLE(normalized[j], (i * dim + j) * 4);
    }
  }
  fs.mkdirSync(path.dirname(vectorBinPath(vectorSet.id)), { recursive: true });
  fs.writeFileSync(vectorBinPath(vectorSet.id), buffer);
  fs.writeFileSync(vectorMetaPath(vectorSet.id), `${JSON.stringify(vectorSet, null, 2)}\n`);
}

function loadVectorSet(id) {
  const metaPath = vectorMetaPath(id);
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const buffer = fs.readFileSync(vectorBinPath(id));
  const dim = meta.dim;
  const count = meta.count;
  const vectors = [];
  for (let i = 0; i < count; i += 1) {
    const vec = new Float32Array(dim);
    for (let j = 0; j < dim; j += 1) {
      vec[j] = buffer.readFloatLE((i * dim + j) * 4);
    }
    vectors.push(vec);
  }
  return { meta, vectors };
}

async function buildCollection({ name, chunkSetId, embeddingConfig, recipeSnapshot }, onProgress) {
  const chunkSet = readSubJson('chunksets', chunkSetId);
  if (!chunkSet) throw new Error(`ChunkSet 不存在: ${chunkSetId}`);

  const vectorSetId = `vs_${uuidv4().slice(0, 8)}`;
  const collectionId = `col_${uuidv4().slice(0, 8)}`;

  if (onProgress) onProgress({ stage: 'embedding', done: 0, total: chunkSet.chunks.length });

  const embedResult = await embedChunks(
    chunkSet.chunks,
    embeddingConfig,
    (p) => onProgress && onProgress({ stage: 'embedding', ...p })
  );

  const vectorSet = {
    id: vectorSetId,
    chunkSetId,
    model: embedResult.model,
    dim: embedResult.dim,
    count: chunkSet.chunks.length,
    chunkIds: chunkSet.chunks.map((c) => c.id),
    cost: embedResult.cost,
    elapsedMs: embedResult.elapsedMs,
    cacheHits: embedResult.cacheHits,
    createdAt: new Date().toISOString(),
  };

  saveVectorSet(vectorSet, embedResult.vectors);

  if (onProgress) onProgress({ stage: 'bm25', done: 0, total: 1 });
  const bm25 = new BM25Index();
  bm25.build(chunkSet.chunks);
  const bm25Path = path.join(dataDir, 'vectors', `${vectorSetId}.bm25.json`);
  fs.writeFileSync(bm25Path, JSON.stringify(bm25.serialize()));

  const collection = {
    id: collectionId,
    name: name || `Collection ${new Date().toLocaleString('zh-CN')}`,
    chunkSetId,
    vectorSetId,
    recipeSnapshot: recipeSnapshot || null,
    embedding: {
      model: embedResult.model,
      dimensions: normalizeDimensions(embeddingConfig?.dimensions),
      dim: embedResult.dim,
    },
    stats: {
      chunkCount: chunkSet.chunks.length,
      model: embedResult.model,
      dim: embedResult.dim,
      cost: embedResult.cost,
    },
    builtAt: new Date().toISOString(),
  };

  const collections = getCollections();
  collections.unshift(collection);
  saveCollections(collections);

  if (onProgress) onProgress({ stage: 'done', collection });
  return collection;
}

module.exports = { buildCollection, saveVectorSet, loadVectorSet, vectorMetaPath };
