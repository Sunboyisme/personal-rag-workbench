const IMPORT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.pdf', '.docx']);

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.canvas', '.mp4', '.mp3', '.zip', '.rar',
]);

const SKIP_DIR_NAMES = new Set(['.obsidian', '.git', 'node_modules', '.trash', '.cursor']);

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function getExtension(filePath) {
  const base = normalizePath(filePath).split('/').pop() || '';
  const idx = base.lastIndexOf('.');
  return idx === -1 ? '' : base.slice(idx).toLowerCase();
}

function shouldSkipPath(filePath) {
  const normalized = normalizePath(filePath);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => SKIP_DIR_NAMES.has(part))) {
    return { skip: true, reason: '系统或隐藏目录' };
  }
  if (parts.some((part) => part.startsWith('.') && !IMPORT_EXTENSIONS.has(getExtension(part)))) {
    return { skip: true, reason: '系统或隐藏目录' };
  }
  const ext = getExtension(normalized);
  if (SKIP_EXTENSIONS.has(ext)) {
    return { skip: true, reason: '附件/图片已跳过' };
  }
  return { skip: false };
}

function isImportablePath(filePath) {
  const check = shouldSkipPath(filePath);
  if (check.skip) return check;
  const ext = getExtension(filePath);
  if (IMPORT_EXTENSIONS.has(ext)) return { skip: false, importable: true };
  return { skip: true, reason: '不支持的格式' };
}

function titleFromPath(filePath) {
  const normalized = normalizePath(filePath);
  const withoutExt = normalized.replace(/\.[^./\\]+$/, '');
  const parts = withoutExt.split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] || '未命名';
  return withoutExt;
}

module.exports = {
  IMPORT_EXTENSIONS,
  SKIP_EXTENSIONS,
  SKIP_DIR_NAMES,
  normalizePath,
  getExtension,
  shouldSkipPath,
  isImportablePath,
  titleFromPath,
};
