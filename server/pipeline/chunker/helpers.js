const { chunkId } = require('../../utils/hash');
const { estimateTokens } = require('../../utils/tokens');

function buildChunk(sourceId, text, charStart, charEnd, meta = {}) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return {
    id: chunkId(sourceId, charStart, trimmed),
    sourceId,
    text: trimmed,
    charStart,
    charEnd,
    tokens: estimateTokens(trimmed),
    headingPath: meta.headingPath || [],
    parentId: meta.parentId || null,
    meta: meta.meta || {},
  };
}

function fixedChunk(text, sourceId, config = {}) {
  const size = Number(config.chunkSize || 500);
  const overlap = Number(config.overlap || 50);
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + size);
    const chunk = buildChunk(sourceId, text.slice(start, end), start, end, {
      headingPath: config.headingPath || [],
      meta: config.meta || {},
    });
    if (chunk) chunks.push(chunk);
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function recursiveChunk(text, sourceId, config = {}) {
  const size = Number(config.chunkSize || 500);
  const overlap = Number(config.overlap || 50);
  const separators = config.separators || ['\n\n', '\n', '。', '！', '？', '. ', ' '];

  function split(t, startOffset) {
    if (t.length <= size) {
      const c = buildChunk(sourceId, t, startOffset, startOffset + t.length, {
        headingPath: config.headingPath || [],
        meta: config.meta || {},
      });
      return c ? [c] : [];
    }
    for (const sep of separators) {
      const idx = t.lastIndexOf(sep, size);
      if (idx > size * 0.3) {
        const part = t.slice(0, idx + sep.length);
        const rest = t.slice(Math.max(0, idx + sep.length - overlap));
        const first = buildChunk(sourceId, part, startOffset, startOffset + part.length, {
          headingPath: config.headingPath || [],
          meta: config.meta || {},
        });
        const restChunks = split(rest, startOffset + idx + sep.length - overlap);
        return [...(first ? [first] : []), ...restChunks];
      }
    }
    return fixedChunk(t, sourceId, config);
  }

  return split(text, 0);
}

module.exports = {
  buildChunk,
  fixedChunk,
  recursiveChunk,
};
