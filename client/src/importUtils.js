const IMPORTABLE_RE = /\.(md|markdown|txt|pdf|docx)$/i;
const SKIP_IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|canvas|mp4|mp3|zip|rar)$/i;
const SKIP_DIR_NAMES = new Set(['.obsidian', '.git', 'node_modules', '.trash', '.cursor']);

function shouldSkipPath(rel) {
  const parts = rel.split('/').filter(Boolean);
  if (parts.some((part) => SKIP_DIR_NAMES.has(part))) return true;
  // 跳过隐藏目录，但不误伤 file.md 这类正常文件名
  return parts.some((part) => part.startsWith('.') && !IMPORTABLE_RE.test(part));
}

export function filterImportFiles(fileList) {
  const importable = [];
  const skipped = [];

  for (const file of fileList) {
    const rel = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
    if (shouldSkipPath(rel)) {
      skipped.push({ name: rel, reason: '系统或隐藏目录' });
      continue;
    }
    if (SKIP_IMAGE_RE.test(rel)) {
      skipped.push({ name: rel, reason: '附件/图片已跳过' });
      continue;
    }
    if (IMPORTABLE_RE.test(rel)) {
      importable.push(file);
      continue;
    }
    skipped.push({ name: rel, reason: '不支持的格式' });
  }

  return { importable, skipped };
}

export function formatImportSummary(result, preSkipped = []) {
  const created = result.created?.length || 0;
  const skipped = (result.skipped?.length || 0) + preSkipped.length;
  const failed = result.failed?.length || 0;
  const parts = [`成功导入 ${created} 篇`];
  if (skipped) parts.push(`跳过 ${skipped} 个`);
  if (failed) parts.push(`失败 ${failed} 个`);
  return parts.join('，');
}
