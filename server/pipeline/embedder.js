const fs = require('fs');
const path = require('path');
const { getSettings } = require('../store');
const { stableHash } = require('../utils/hash');
const { joinApiUrl } = require('../utils/apiUrl');

const CACHE_DIR = () => path.join(require('../config').dataDir, 'embedding_cache');

function cacheKey(chunkIdValue, model, dim) {
  return stableHash(`${chunkIdValue}:${model}:${dim || 'default'}`);
}

function readCache(chunkIdValue, model, dim) {
  const file = path.join(CACHE_DIR(), `${cacheKey(chunkIdValue, model, dim)}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeCache(chunkIdValue, model, dim, vector) {
  const dir = CACHE_DIR();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${cacheKey(chunkIdValue, model, dim)}.json`);
  fs.writeFileSync(file, JSON.stringify({ vector, cachedAt: new Date().toISOString() }));
}

async function embedTexts(texts, options = {}) {
  const settings = getSettings();
  const apiKey = options.apiKey || settings.embedding.apiKey;
  const baseUrl = options.baseUrl || settings.embedding.baseUrl;
  const model = options.model || settings.embedding.model;
  const dimensions = options.dimensions !== undefined
    ? options.dimensions
    : settings.embedding.dimensions;

  if (!apiKey) {
    throw new Error('未配置 SILICONFLOW_API_KEY，无法向量化');
  }

  const supportsDimensions = /Qwen\/Qwen3-Embedding/i.test(model);
  const batchSize = 32;
  const allVectors = [];
  let totalTokens = 0;
  const start = Date.now();

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const body = { model, input: batch };
    if (supportsDimensions && dimensions) body.dimensions = Number(dimensions);

    const response = await fetch(joinApiUrl(baseUrl, '/v1/embeddings'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Embedding API 失败: ${response.status} ${errText}`);
    }

    const data = await response.json();
    const sorted = [...data.data].sort((a, b) => a.index - b.index);
    allVectors.push(...sorted.map((item) => item.embedding));
    totalTokens += data.usage?.total_tokens || 0;
  }

  const dim = allVectors[0]?.length || dimensions || 0;
  const elapsedMs = Date.now() - start;
  const cost = estimateCost(model, totalTokens);

  return { vectors: allVectors, dim, totalTokens, elapsedMs, cost, model };
}

function estimateCost(model, tokens) {
  const rates = {
    'BAAI/bge-m3': 0.0001,
    'BAAI/bge-large-zh-v1.5': 0.0001,
    'Qwen/Qwen3-Embedding-0.6B': 0.00001,
    'Qwen/Qwen3-Embedding-4B': 0.00002,
    'Qwen/Qwen3-Embedding-8B': 0.00004,
  };
  const rate = rates[model] || 0.0001;
  return Number(((tokens / 1_000_000) * rate).toFixed(6));
}

async function embedChunks(chunks, options = {}, onProgress) {
  const model = options.model;
  const dim = options.dimensions;
  const texts = [];
  const indices = [];
  const vectors = new Array(chunks.length);

  for (let i = 0; i < chunks.length; i += 1) {
    const cached = readCache(chunks[i].id, model, dim);
    if (cached) {
      vectors[i] = cached.vector;
    } else {
      texts.push(chunks[i].text);
      indices.push(i);
    }
  }

  if (texts.length > 0) {
    const result = await embedTexts(texts, options);
    result.vectors.forEach((vector, idx) => {
      const chunkIdx = indices[idx];
      vectors[chunkIdx] = vector;
      writeCache(chunks[chunkIdx].id, model, dim, vector);
    });
    if (onProgress) onProgress({ done: chunks.length - texts.length + result.vectors.length, total: chunks.length });
    return {
      vectors,
      dim: result.dim,
      totalTokens: result.totalTokens,
      elapsedMs: result.elapsedMs,
      cost: result.cost,
      model: result.model,
      cacheHits: chunks.length - texts.length,
    };
  }

  return {
    vectors,
    dim: vectors[0]?.length || 0,
    totalTokens: 0,
    elapsedMs: 0,
    cost: 0,
    model,
    cacheHits: chunks.length,
  };
}

async function embedQuery(text, options = {}) {
  const result = await embedTexts([text], options);
  return result.vectors[0];
}

module.exports = { embedTexts, embedChunks, embedQuery, readCache, writeCache };
