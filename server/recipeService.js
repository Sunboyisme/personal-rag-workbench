const { v4: uuidv4 } = require('uuid');
const {
  getRecipes,
  saveRecipes,
  getRecipe,
  writeSubJson,
  readSubJson,
  listSubJson,
} = require('./store');

function defaultRecipe() {
  return {
    id: 'recipe_default',
    name: '默认配置',
    parentId: null,
    chunking: {
      strategy: 'heading',
      chunkSize: 800,
      overlap: 50,
      childSize: 300,
      parentSize: 1500,
    },
    embedding: {
      model: 'BAAI/bge-m3',
      dimensions: null,
    },
    retrieval: {
      topK: 20,
      finalTopK: 5,
      vectorThreshold: 0.4,
      rerankThreshold: 0.3,
      similarityThreshold: 0.3,
      thresholdMode: 'rerank',
      useBm25: true,
      useRerank: true,
      rrfK: 60,
      vectorWeight: 1,
      bm25Weight: 1,
      rerankTopN: 10,
      minVectorScoreForRerank: null,
      queryRewrite: 'off',
    },
    prompt: {
      tokenBudget: 4000,
    },
    generation: {
      temperature: 0.3,
      maxTokens: 2000,
    },
    createdAt: new Date().toISOString(),
  };
}

function normalizeRetrieval(retrieval = {}) {
  const defaults = defaultRecipe().retrieval;
  const next = { ...defaults, ...retrieval };
  if (retrieval.vectorThreshold == null && retrieval.similarityThreshold != null) {
    next.vectorThreshold = Number(retrieval.similarityThreshold);
  }
  if (retrieval.rerankThreshold == null && retrieval.similarityThreshold != null) {
    next.rerankThreshold = Number(retrieval.similarityThreshold);
  }
  // 兼容旧字段：当前生效阈值回写到 similarityThreshold，便于旧 UI 读取
  const mode = String(next.thresholdMode || '').toLowerCase();
  if (mode === 'vector') next.similarityThreshold = next.vectorThreshold;
  else if (mode === 'off') next.similarityThreshold = null;
  else next.similarityThreshold = next.rerankThreshold;
  return next;
}

function normalizeRecipe(recipe) {
  if (!recipe) return recipe;
  return {
    ...defaultRecipe(),
    ...recipe,
    chunking: { ...defaultRecipe().chunking, ...(recipe.chunking || {}) },
    embedding: { ...defaultRecipe().embedding, ...(recipe.embedding || {}) },
    retrieval: normalizeRetrieval(recipe.retrieval || {}),
    prompt: { ...defaultRecipe().prompt, ...(recipe.prompt || {}) },
    generation: { ...defaultRecipe().generation, ...(recipe.generation || {}) },
  };
}

function ensureDefaultRecipe() {
  const recipes = getRecipes();
  if (!recipes.length) {
    const created = defaultRecipe();
    saveRecipes([created]);
    return [created];
  }
  const normalized = recipes.map(normalizeRecipe);
  const changed = JSON.stringify(normalized) !== JSON.stringify(recipes);
  if (changed) saveRecipes(normalized);
  return normalized;
}

function listRecipes() {
  return ensureDefaultRecipe();
}

function getActiveRecipeId(preferredId) {
  const recipes = listRecipes();
  if (preferredId && recipes.some((r) => r.id === preferredId)) return preferredId;
  const { getSavedSettingsFile } = require('./store');
  const saved = getSavedSettingsFile();
  if (saved.activeRecipeId && recipes.some((r) => r.id === saved.activeRecipeId)) {
    return saved.activeRecipeId;
  }
  return recipes[0]?.id || null;
}

function resolveRecipe(recipeId) {
  const recipes = listRecipes();
  const id = getActiveRecipeId(recipeId);
  return recipes.find((r) => r.id === id) || recipes[0] || null;
}

function applyLabRetrieval({ mode = 'update', recipeId, name, retrieval, setActive = true }) {
  const payload = normalizeRetrieval(retrieval || {});
  let recipe;
  if (mode === 'create') {
    recipe = createRecipe({
      name: name || `Lab ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      retrieval: payload,
    });
  } else {
    const targetId = getActiveRecipeId(recipeId);
    const updated = updateRecipe(targetId, { retrieval: payload });
    if (!updated) throw new Error('Recipe 不存在');
    recipe = updated;
  }

  if (setActive) {
    const { saveSettings } = require('./store');
    saveSettings({ activeRecipeId: recipe.id });
  }

  return { recipe, activeRecipeId: recipe.id };
}

function createRecipe(input = {}) {
  const recipes = ensureDefaultRecipe();
  const recipe = normalizeRecipe({
    ...defaultRecipe(),
    ...input,
    id: `recipe_${uuidv4().slice(0, 8)}`,
    parentId: input.parentId || null,
    createdAt: new Date().toISOString(),
  });
  recipes.unshift(recipe);
  saveRecipes(recipes);
  return recipe;
}

function forkRecipe(id, name) {
  const parent = listRecipes().find((r) => r.id === id) || getRecipe(id);
  if (!parent) throw new Error('Recipe 不存在');
  return createRecipe({
    ...structuredClone(parent),
    name: name || `${parent.name} (fork)`,
    parentId: id,
  });
}

function updateRecipe(id, patch) {
  const recipes = ensureDefaultRecipe();
  const idx = recipes.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const current = recipes[idx];
  const merged = {
    ...current,
    ...patch,
    id,
    chunking: patch.chunking ? { ...current.chunking, ...patch.chunking } : current.chunking,
    embedding: patch.embedding ? { ...current.embedding, ...patch.embedding } : current.embedding,
    retrieval: patch.retrieval ? { ...current.retrieval, ...patch.retrieval } : current.retrieval,
    prompt: patch.prompt ? { ...current.prompt, ...patch.prompt } : current.prompt,
    generation: patch.generation ? { ...current.generation, ...patch.generation } : current.generation,
    updatedAt: new Date().toISOString(),
  };
  recipes[idx] = normalizeRecipe(merged);
  saveRecipes(recipes);
  return recipes[idx];
}

function diffRecipes(aId, bId) {
  const recipes = listRecipes();
  const a = recipes.find((r) => r.id === aId);
  const b = recipes.find((r) => r.id === bId);
  if (!a || !b) throw new Error('Recipe 不存在');
  const diffs = [];
  for (const section of ['chunking', 'embedding', 'retrieval', 'prompt', 'generation']) {
    const av = JSON.stringify(a[section] || {});
    const bv = JSON.stringify(b[section] || {});
    if (av !== bv) diffs.push({ section, a: a[section], b: b[section] });
  }
  return { a, b, diffs };
}

function saveTrace(trace) {
  const id = trace.id || `trace_${uuidv4().slice(0, 8)}`;
  const record = { ...trace, id, createdAt: trace.createdAt || new Date().toISOString() };
  writeSubJson('traces', id, record);
  return record;
}

function getTrace(id) {
  return readSubJson('traces', id);
}

function listTraces(limit = 50) {
  return listSubJson('traces')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

module.exports = {
  defaultRecipe,
  ensureDefaultRecipe,
  normalizeRetrieval,
  listRecipes,
  createRecipe,
  forkRecipe,
  updateRecipe,
  diffRecipes,
  getActiveRecipeId,
  resolveRecipe,
  applyLabRetrieval,
  saveTrace,
  getTrace,
  listTraces,
};
