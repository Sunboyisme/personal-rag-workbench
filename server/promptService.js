const { v4: uuidv4 } = require('uuid');
const {
  readJson,
  writeJson,
  getSavedSettingsFile,
  saveSettings,
} = require('./store');

const PROMPTS_FILE = 'prompts.json';

function defaultTemplates() {
  return {
    system:
      '你是一个基于个人知识库回答问题的助手。请仅根据提供的上下文回答，并在引用处标注 [n]。如果上下文不足以回答，请明确说明。',
    chunkTemplate:
      '[{{index}}] 来源: {{sourceTitle}}\n路径: {{headingPath}}\n{{text}}',
    userTemplate: '问题：{{question}}\n\n请根据以上参考资料回答。',
    semanticSystem:
      '你是文档语义切分助手。根据主题连贯性把编号文本单元分成若干 chunk。只输出 JSON，不要解释。',
    semanticUser:
      '请将下列编号单元分组。\n目标每块约 {{targetSize}} 字，允许在 {{minSize}}-{{maxSize}} 字之间浮动。\n规则：\n1. 每个编号必须且只能出现一次\n2. 每组内编号必须连续\n3. 优先在主题切换处切开，不要把无关主题硬拼在一起\n4. 只返回 JSON：{"groups":[[0,1],[2,3,4]]}\n\n单元列表：\n{{units}}',
  };
}

function defaultPromptVersion(overrides = {}) {
  const templates = defaultTemplates();
  return {
    id: 'prompt_default',
    name: '默认提示词',
    parentId: null,
    ...templates,
    ...overrides,
    createdAt: overrides.createdAt || new Date().toISOString(),
  };
}

function isLegacyFlat(data) {
  return data && !Array.isArray(data) && typeof data === 'object' && typeof data.system === 'string';
}

function normalizeVersion(version) {
  const defaults = defaultPromptVersion();
  if (!version) return defaults;
  return {
    ...defaults,
    ...version,
    id: version.id || `prompt_${uuidv4().slice(0, 8)}`,
    name: version.name || '未命名提示词',
    parentId: version.parentId || null,
    system: version.system ?? defaults.system,
    chunkTemplate: version.chunkTemplate ?? defaults.chunkTemplate,
    userTemplate: version.userTemplate ?? defaults.userTemplate,
    semanticSystem: version.semanticSystem ?? defaults.semanticSystem,
    semanticUser: version.semanticUser ?? defaults.semanticUser,
  };
}

function readRawPrompts() {
  return readJson(PROMPTS_FILE, []);
}

function savePromptVersions(versions) {
  writeJson(PROMPTS_FILE, versions);
  return versions;
}

function ensurePromptVersions() {
  const raw = readRawPrompts();
  if (Array.isArray(raw) && raw.length) {
    const normalized = raw.map(normalizeVersion);
    if (JSON.stringify(normalized) !== JSON.stringify(raw)) {
      savePromptVersions(normalized);
    }
    return normalized;
  }

  if (isLegacyFlat(raw)) {
    const migrated = [
      normalizeVersion({
        id: 'prompt_default',
        name: '默认提示词',
        parentId: null,
        system: raw.system,
        chunkTemplate: raw.chunkTemplate,
        userTemplate: raw.userTemplate,
        semanticSystem: raw.semanticSystem,
        semanticUser: raw.semanticUser,
        createdAt: new Date().toISOString(),
      }),
    ];
    savePromptVersions(migrated);
    const saved = getSavedSettingsFile();
    if (!saved.activePromptId) {
      saveSettings({ activePromptId: 'prompt_default' });
    }
    return migrated;
  }

  const created = [defaultPromptVersion()];
  savePromptVersions(created);
  saveSettings({ activePromptId: 'prompt_default' });
  return created;
}

function listPromptVersions() {
  return ensurePromptVersions();
}

function getActivePromptId(preferredId) {
  const versions = listPromptVersions();
  if (preferredId && versions.some((v) => v.id === preferredId)) return preferredId;
  const saved = getSavedSettingsFile();
  if (saved.activePromptId && versions.some((v) => v.id === saved.activePromptId)) {
    return saved.activePromptId;
  }
  return versions[0]?.id || null;
}

function resolvePromptVersion(promptId) {
  const versions = listPromptVersions();
  const id = getActivePromptId(promptId);
  return versions.find((v) => v.id === id) || versions[0] || defaultPromptVersion();
}

function getActiveTemplates(promptId) {
  const version = resolvePromptVersion(promptId);
  return {
    system: version.system,
    chunkTemplate: version.chunkTemplate,
    userTemplate: version.userTemplate,
    semanticSystem: version.semanticSystem,
    semanticUser: version.semanticUser,
  };
}

function createPromptVersion(input = {}) {
  const versions = ensurePromptVersions();
  const version = normalizeVersion({
    ...defaultPromptVersion(),
    ...input,
    id: `prompt_${uuidv4().slice(0, 8)}`,
    parentId: input.parentId || null,
    createdAt: new Date().toISOString(),
  });
  versions.unshift(version);
  savePromptVersions(versions);
  return version;
}

function forkPromptVersion(id, name) {
  const parent = listPromptVersions().find((v) => v.id === id);
  if (!parent) throw new Error('提示词版本不存在');
  return createPromptVersion({
    ...structuredClone(parent),
    name: name || `${parent.name} (副本)`,
    parentId: id,
  });
}

function updatePromptVersion(id, patch = {}) {
  const versions = ensurePromptVersions();
  const idx = versions.findIndex((v) => v.id === id);
  if (idx < 0) return null;
  const current = versions[idx];
  const merged = normalizeVersion({
    ...current,
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  });
  versions[idx] = merged;
  savePromptVersions(versions);
  return merged;
}

function setActivePrompt(promptId) {
  const versions = listPromptVersions();
  if (!versions.some((v) => v.id === promptId)) {
    throw new Error(`提示词版本不存在: ${promptId}`);
  }
  saveSettings({ activePromptId: promptId });
  return {
    activePromptId: promptId,
    version: versions.find((v) => v.id === promptId),
  };
}

function deletePromptVersion(id) {
  const versions = ensurePromptVersions();
  if (versions.length <= 1) {
    throw new Error('至少保留一个提示词版本');
  }
  const idx = versions.findIndex((v) => v.id === id);
  if (idx < 0) throw new Error('提示词版本不存在');

  const removed = versions[idx];
  versions.splice(idx, 1);
  savePromptVersions(versions);

  const activeId = getActivePromptId();
  if (activeId === id) {
    const next = versions[0];
    saveSettings({ activePromptId: next.id });
    return { deleted: removed, activePromptId: next.id, versions };
  }
  return { deleted: removed, activePromptId: activeId, versions };
}

function diffPromptVersions(aId, bId) {
  const versions = listPromptVersions();
  const a = versions.find((v) => v.id === aId);
  const b = versions.find((v) => v.id === bId);
  if (!a || !b) throw new Error('提示词版本不存在');
  const fields = ['system', 'chunkTemplate', 'userTemplate', 'semanticSystem', 'semanticUser'];
  const diffs = [];
  for (const field of fields) {
    if (String(a[field] || '') !== String(b[field] || '')) {
      diffs.push({ field, a: a[field], b: b[field] });
    }
  }
  return { a, b, diffs };
}

module.exports = {
  defaultTemplates,
  defaultPromptVersion,
  ensurePromptVersions,
  listPromptVersions,
  getActivePromptId,
  resolvePromptVersion,
  getActiveTemplates,
  createPromptVersion,
  forkPromptVersion,
  updatePromptVersion,
  setActivePrompt,
  deletePromptVersion,
  diffPromptVersions,
};
