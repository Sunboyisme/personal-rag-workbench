function normalizeDimensions(dim) {
  if (dim === null || dim === undefined || dim === '') return null;
  const n = Number(dim);
  return Number.isFinite(n) ? n : null;
}

function resolveCollectionEmbedding(collection, vectorMeta = null) {
  if (collection?.embedding?.model) {
    return {
      model: collection.embedding.model,
      dimensions: normalizeDimensions(collection.embedding.dimensions),
      dim: collection.embedding.dim ?? vectorMeta?.dim ?? collection.stats?.dim,
    };
  }

  // 兼容旧 Collection（仅有 stats / vectorSet meta）
  const model = vectorMeta?.model ?? collection?.stats?.model;
  const dim = vectorMeta?.dim ?? collection?.stats?.dim;
  if (!model) {
    throw new Error('Collection 缺少 embedding 配置，请重新建库');
  }
  return { model, dimensions: null, dim };
}

function formatEmbeddingLabel(config) {
  const dim = config.dimensions ?? config.dim ?? '默认';
  return `${config.model}（${dim} 维）`;
}

function embeddingConfigsMatch(expected, requested) {
  if (!requested?.model) return true;
  if (expected.model !== requested.model) return false;
  const expectedDim = expected.dimensions ?? expected.dim;
  const requestedDim = normalizeDimensions(requested.dimensions) ?? requested.dim;
  if (expectedDim != null && requestedDim != null && expectedDim !== requestedDim) {
    return false;
  }
  return true;
}

function assertEmbeddingMatch(collectionConfig, requestedConfig) {
  if (!requestedConfig?.model) return collectionConfig;
  if (!embeddingConfigsMatch(collectionConfig, requestedConfig)) {
    throw new Error(
      `Embedding 模型不一致：Collection 使用 ${formatEmbeddingLabel(collectionConfig)}，` +
        `当前请求 ${formatEmbeddingLabel(requestedConfig)}。` +
        `检索必须使用建库时的同一模型，请重新建库或切换 Collection。`
    );
  }
  return collectionConfig;
}

function buildEmbeddingOptions(config) {
  const options = { model: config.model };
  const dimensions = normalizeDimensions(config.dimensions);
  if (dimensions) options.dimensions = dimensions;
  return options;
}

module.exports = {
  normalizeDimensions,
  resolveCollectionEmbedding,
  formatEmbeddingLabel,
  embeddingConfigsMatch,
  assertEmbeddingMatch,
  buildEmbeddingOptions,
};
