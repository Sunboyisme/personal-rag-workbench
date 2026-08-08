/**
 * 修复 multipart 上传时 UTF-8 文件名被 busboy/multer 按 latin1 读取导致的乱码。
 */
function decodeMultipartFilename(name) {
  if (!name) return '';
  const normalized = String(name).replace(/\\/g, '/');
  // 已包含中文等 Unicode 字符（超出 Latin-1），说明无需转换
  if (/[^\u0000-\u00ff]/.test(normalized)) return normalized;
  return Buffer.from(normalized, 'latin1').toString('utf8');
}

module.exports = { decodeMultipartFilename };
