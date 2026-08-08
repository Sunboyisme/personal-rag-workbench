const { buildChunk, fixedChunk, recursiveChunk } = require('./helpers');
const { semanticChunk } = require('./semantic');

function parseHeadings(text) {
  const lines = text.split('\n');
  const sections = [];
  let current = { level: 0, title: '', lines: [], start: 0 };
  let offset = 0;

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      if (current.lines.length > 0 || current.title) {
        sections.push({
          ...current,
          text: current.lines.join('\n').trim(),
          end: offset,
        });
      }
      current = {
        level: m[1].length,
        title: m[2].trim(),
        lines: [],
        start: offset,
        headingLine: line,
      };
    } else {
      current.lines.push(line);
    }
    offset += line.length + 1;
  }
  if (current.lines.length > 0 || current.title) {
    sections.push({ ...current, text: current.lines.join('\n').trim(), end: offset });
  }
  return sections;
}

function headingChunk(text, sourceId, config = {}) {
  const maxSize = Number(config.chunkSize || 800);
  const sections = parseHeadings(text);
  const chunks = [];
  const pathStack = [];

  for (const section of sections) {
    while (pathStack.length && pathStack[pathStack.length - 1].level >= section.level) {
      pathStack.pop();
    }
    if (section.title) pathStack.push({ level: section.level, title: section.title });
    const headingPath = pathStack.map((p) => p.title);
    const body = [section.headingLine, section.text].filter(Boolean).join('\n').trim();
    if (!body) continue;
    if (body.length <= maxSize) {
      const c = buildChunk(sourceId, body, section.start, section.end, {
        headingPath,
        meta: config.meta || {},
      });
      if (c) chunks.push(c);
    } else {
      chunks.push(
        ...recursiveChunk(body, sourceId, {
          ...config,
          chunkSize: maxSize,
          headingPath,
        })
      );
    }
  }
  return chunks;
}

function parentChildChunk(text, sourceId, config = {}) {
  const childSize = Number(config.childSize || 300);
  const parentSections = headingChunk(text, sourceId, {
    ...config,
    chunkSize: Number(config.parentSize || 1500),
  });
  const children = [];
  for (const parent of parentSections) {
    const childChunks = fixedChunk(parent.text, sourceId, {
      chunkSize: childSize,
      overlap: Number(config.overlap || 30),
      headingPath: parent.headingPath,
      meta: parent.meta,
    }).map((c) => ({ ...c, parentId: parent.id }));
    children.push(parent, ...childChunks);
  }
  return children;
}

function chunkText(text, sourceId, config = {}) {
  const strategy = config.strategy || 'heading';
  if (strategy === 'semantic') {
    throw new Error('语义切分需要异步执行，请使用 chunkTextAsync');
  }
  switch (strategy) {
    case 'fixed':
      return fixedChunk(text, sourceId, config);
    case 'recursive':
      return recursiveChunk(text, sourceId, config);
    case 'parentChild':
      return parentChildChunk(text, sourceId, config);
    case 'heading':
    default:
      return headingChunk(text, sourceId, config);
  }
}

async function chunkTextAsync(text, sourceId, config = {}, onEvent) {
  const strategy = config.strategy || 'heading';
  if (strategy === 'semantic') {
    return semanticChunk(text, sourceId, config, onEvent);
  }
  const chunks = chunkText(text, sourceId, config);
  if (onEvent) {
    onEvent('progress', { stage: 'sync', message: '正在切分…' });
    chunks.forEach((chunk, index) => onEvent('chunk', { chunk, index: index + 1 }));
  }
  return chunks;
}

function computeStats(chunks) {
  if (!chunks.length) return { count: 0, avgLen: 0, p95Len: 0 };
  const lengths = chunks.map((c) => c.text.length).sort((a, b) => a - b);
  const p95Idx = Math.min(lengths.length - 1, Math.floor(lengths.length * 0.95));
  return {
    count: chunks.length,
    avgLen: Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length),
    p95Len: lengths[p95Idx],
  };
}

module.exports = {
  chunkText,
  chunkTextAsync,
  fixedChunk,
  recursiveChunk,
  headingChunk,
  parentChildChunk,
  semanticChunk,
  computeStats,
};
