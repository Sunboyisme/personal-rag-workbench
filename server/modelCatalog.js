const DEFAULT_MODELS = {
  chat: [
    { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash' },
  ],
  embedding: [
    { id: 'BAAI/bge-m3', name: 'BAAI/bge-m3', dim: 1024 },
    { id: 'BAAI/bge-large-zh-v1.5', name: 'BAAI/bge-large-zh-v1.5', dim: 1024 },
    {
      id: 'Qwen/Qwen3-Embedding-0.6B',
      name: 'Qwen/Qwen3-Embedding-0.6B',
      dim: 1024,
      dimensionsOptions: [64, 128, 256, 512, 768, 1024],
    },
    {
      id: 'Qwen/Qwen3-Embedding-4B',
      name: 'Qwen/Qwen3-Embedding-4B',
      dim: 2560,
      dimensionsOptions: [64, 128, 256, 512, 1024, 1568, 2560],
    },
    {
      id: 'Qwen/Qwen3-Embedding-8B',
      name: 'Qwen/Qwen3-Embedding-8B',
      dim: 4096,
      dimensionsOptions: [64, 128, 256, 512, 1024, 2048, 4096],
    },
  ],
  rerank: [
    { id: 'BAAI/bge-reranker-v2-m3', name: 'BAAI/bge-reranker-v2-m3' },
    { id: 'Pro/BAAI/bge-reranker-v2-m3', name: 'Pro/BAAI/bge-reranker-v2-m3' },
    { id: 'netease-youdao/bce-reranker-base_v1', name: 'netease-youdao/bce-reranker-base_v1' },
    { id: 'Qwen/Qwen3-Reranker-0.6B', name: 'Qwen/Qwen3-Reranker-0.6B' },
    { id: 'Qwen/Qwen3-Reranker-4B', name: 'Qwen/Qwen3-Reranker-4B' },
    { id: 'Qwen/Qwen3-Reranker-8B', name: 'Qwen/Qwen3-Reranker-8B' },
  ],
};

function normalizeCustomList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const id = String(typeof item === 'string' ? item : item?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function mergeCatalog(custom = {}) {
  const result = {};
  for (const kind of Object.keys(DEFAULT_MODELS)) {
    const defaults = DEFAULT_MODELS[kind];
    const defaultIds = new Set(defaults.map((m) => m.id));
    const customIds = normalizeCustomList(custom[kind]).filter((id) => !defaultIds.has(id));
    result[kind] = [
      ...defaults,
      ...customIds.map((id) => ({ id, name: id, custom: true })),
    ];
  }
  return result;
}

function isDefaultModel(kind, modelId) {
  return (DEFAULT_MODELS[kind] || []).some((m) => m.id === modelId);
}

module.exports = {
  DEFAULT_MODELS,
  normalizeCustomList,
  mergeCatalog,
  isDefaultModel,
};
