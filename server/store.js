const fs = require('fs');
const path = require('path');
const { dataDir } = require('./config');

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
  for (const sub of ['sources', 'chunksets', 'vectors', 'traces', 'embedding_cache']) {
    fs.mkdirSync(path.join(dataDir, sub), { recursive: true });
  }
}

function filePath(name) {
  return path.join(dataDir, name);
}

function readJson(name, fallback) {
  ensureDataDir();
  const target = filePath(name);
  if (!fs.existsSync(target)) return structuredClone(fallback);
  const text = fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

function writeJson(name, value) {
  ensureDataDir();
  fs.writeFileSync(filePath(name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return value;
}

function readSubJson(subdir, id, fallback = null) {
  ensureDataDir();
  const target = path.join(dataDir, subdir, `${id}.json`);
  if (!fs.existsSync(target)) return fallback;
  return JSON.parse(fs.readFileSync(target, 'utf8').replace(/^\uFEFF/, ''));
}

function writeSubJson(subdir, id, value) {
  ensureDataDir();
  const target = path.join(dataDir, subdir, `${id}.json`);
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return value;
}

function listSubJson(subdir) {
  ensureDataDir();
  const dir = path.join(dataDir, subdir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
}

function deleteSubJson(subdir, id) {
  const target = path.join(dataDir, subdir, `${id}.json`);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

function getSources() {
  return readJson('sources.json', []);
}

function saveSources(sources) {
  return writeJson('sources.json', sources);
}

function getSource(id) {
  return getSources().find((s) => s.id === id) || null;
}

function getCollections() {
  return readJson('collections.json', []);
}

function saveCollections(collections) {
  return writeJson('collections.json', collections);
}

function getCollection(id) {
  return getCollections().find((c) => c.id === id) || null;
}

function getRecipes() {
  return readJson('recipes.json', []);
}

function saveRecipes(recipes) {
  return writeJson('recipes.json', recipes);
}

function getRecipe(id) {
  return getRecipes().find((r) => r.id === id) || null;
}

function getEvalSet() {
  return readJson('eval.json', { items: [], runs: [] });
}

function saveEvalSet(data) {
  return writeJson('eval.json', data);
}

function getPromptTemplates() {
  const promptService = require('./promptService');
  return promptService.getActiveTemplates();
}

function savePromptTemplates(templates) {
  // 兼容旧接口：保存到当前激活版本
  const promptService = require('./promptService');
  const activeId = promptService.getActivePromptId();
  if (!activeId) {
    const created = promptService.createPromptVersion(templates);
    promptService.setActivePrompt(created.id);
    return promptService.getActiveTemplates();
  }
  promptService.updatePromptVersion(activeId, templates);
  return promptService.getActiveTemplates();
}

function getSavedSettingsFile() {
  return readJson('settings.json', {});
}

function getCustomModelCatalog() {
  const { normalizeCustomList } = require('./modelCatalog');
  const saved = getSavedSettingsFile();
  const catalog = saved.modelCatalog || {};
  return {
    chat: normalizeCustomList(catalog.chat),
    embedding: normalizeCustomList(catalog.embedding),
    rerank: normalizeCustomList(catalog.rerank),
  };
}

function getSettings() {
  const { chat, embedding, rerank } = require('./config');
  const saved = getSavedSettingsFile();
  return {
    chat: { ...chat, ...(saved.chat || {}) },
    embedding: { ...embedding, ...(saved.embedding || {}) },
    rerank: { ...rerank, ...(saved.rerank || {}) },
    modelCatalog: getCustomModelCatalog(),
  };
}

function getPublicSettings() {
  const { mergeCatalog } = require('./modelCatalog');
  const settings = getSettings();
  const saved = getSavedSettingsFile();
  const mask = (key) => (settings[key]?.apiKey ? '********' : '');
  return {
    chat: { ...settings.chat, apiKey: mask('chat'), apiKeySet: Boolean(settings.chat.apiKey) },
    embedding: {
      ...settings.embedding,
      apiKey: mask('embedding'),
      apiKeySet: Boolean(settings.embedding.apiKey),
    },
    rerank: {
      ...settings.rerank,
      apiKey: mask('rerank'),
      apiKeySet: Boolean(settings.rerank.apiKey),
    },
    modelCatalog: settings.modelCatalog,
    models: mergeCatalog(settings.modelCatalog),
    activeRecipeId: saved.activeRecipeId || null,
    activePromptId: saved.activePromptId || null,
  };
}

function saveSettings(input = {}) {
  const { normalizeCustomList } = require('./modelCatalog');
  const saved = getSavedSettingsFile();
  const patch = (section) => {
    const incoming = { ...(input[section] || {}) };
    const savedSection = { ...(saved[section] || {}) };
    const next = { ...savedSection, ...incoming };
    // 掩码/未传：保留已保存 Key，不把 .env 中的 Key 写入文件
    if (incoming.apiKey === '********' || incoming.apiKey === undefined) {
      if (savedSection.apiKey) next.apiKey = savedSection.apiKey;
      else delete next.apiKey;
    } else if (incoming.apiKey === '') {
      delete next.apiKey;
    }
    return next;
  };
  const nextCatalog = input.modelCatalog
    ? {
        chat: normalizeCustomList(input.modelCatalog.chat),
        embedding: normalizeCustomList(input.modelCatalog.embedding),
        rerank: normalizeCustomList(input.modelCatalog.rerank),
      }
    : saved.modelCatalog || { chat: [], embedding: [], rerank: [] };
  const next = {
    chat: patch('chat'),
    embedding: patch('embedding'),
    rerank: patch('rerank'),
    modelCatalog: nextCatalog,
    activeRecipeId:
      input.activeRecipeId !== undefined ? input.activeRecipeId : saved.activeRecipeId || null,
    activePromptId:
      input.activePromptId !== undefined ? input.activePromptId : saved.activePromptId || null,
  };
  writeJson('settings.json', next);
  return getPublicSettings();
}

module.exports = {
  ensureDataDir,
  readJson,
  writeJson,
  readSubJson,
  writeSubJson,
  listSubJson,
  deleteSubJson,
  getSources,
  saveSources,
  getSource,
  getCollections,
  saveCollections,
  getCollection,
  getRecipes,
  saveRecipes,
  getRecipe,
  getEvalSet,
  saveEvalSet,
  getPromptTemplates,
  savePromptTemplates,
  getSettings,
  getPublicSettings,
  getSavedSettingsFile,
  getCustomModelCatalog,
  saveSettings,
};
