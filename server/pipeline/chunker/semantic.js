const { chatComplete } = require('../../generation/answerer');
const { buildChunk, recursiveChunk } = require('./helpers');

const UNIT_BATCH = 40;

function splitUnits(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];

  const units = [];
  let cursor = 0;
  const blocks = normalized.split(/\n{2,}/);

  for (let b = 0; b < blocks.length; b += 1) {
    const block = blocks[b];
    const leading = normalized.slice(cursor).match(/^\n*/)?.[0].length || 0;
    const start = cursor + leading;
    const end = start + block.length;
    cursor = end;

    if (!block.trim()) continue;

    if (block.length <= 420) {
      units.push({ text: block.trim(), start, end });
      continue;
    }

    const sentenceRe = /[^。！？!?\n]+(?:[。！？!?]+|(?=\n)|$)/g;
    let sm;
    let covered = start;
    while ((sm = sentenceRe.exec(block)) !== null) {
      const piece = sm[0];
      if (!piece.trim()) continue;
      const absStart = start + sm.index;
      const absEnd = absStart + piece.length;
      units.push({ text: piece.trim(), start: absStart, end: absEnd });
      covered = absEnd;
    }
    if (covered < end) {
      const rest = normalized.slice(covered, end).trim();
      if (rest) units.push({ text: rest, start: covered, end });
    }
  }

  return units;
}

function packBySize(units, targetSize) {
  const groups = [];
  let current = [];
  let len = 0;
  for (let i = 0; i < units.length; i += 1) {
    const nextLen = units[i].text.length;
    if (current.length && len + nextLen > targetSize * 1.2) {
      groups.push(current);
      current = [];
      len = 0;
    }
    current.push(i);
    len += nextLen;
    if (len >= targetSize) {
      groups.push(current);
      current = [];
      len = 0;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error('模型未返回有效 JSON');
  }
}

function normalizeGroups(groups, unitCount) {
  if (!Array.isArray(groups) || !groups.length) return null;
  const used = new Set();
  const normalized = [];
  for (const group of groups) {
    if (!Array.isArray(group) || !group.length) continue;
    const ids = [...new Set(group.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n < unitCount))]
      .sort((a, b) => a - b);
    if (!ids.length) continue;
    for (let i = 1; i < ids.length; i += 1) {
      if (ids[i] !== ids[i - 1] + 1) return null;
    }
    if (ids.some((id) => used.has(id))) return null;
    ids.forEach((id) => used.add(id));
    normalized.push(ids);
  }
  if (used.size !== unitCount) return null;
  return normalized.sort((a, b) => a[0] - b[0]);
}

async function proposeGroups(units, targetSize, options = {}) {
  const { getPromptTemplates } = require('../../store');
  const { renderTemplate } = require('../../generation/promptBuilder');
  const templates = {
    ...getPromptTemplates(),
    ...(options.templates || {}),
  };
  const listed = units
    .map((u, idx) => `[${idx}] (${u.text.length}字) ${u.text.slice(0, 240)}${u.text.length > 240 ? '…' : ''}`)
    .join('\n');

  const minSize = Number(options.minSize > 0 ? options.minSize : Math.round(targetSize * 0.5));
  const maxSize = Number(options.maxSize > 0 ? options.maxSize : Math.round(targetSize * 1.5));
  const vars = {
    targetSize,
    minSize,
    maxSize,
    units: listed,
  };

  const messages = [
    {
      role: 'system',
      content: renderTemplate(
        options.semanticSystem || templates.semanticSystem,
        vars
      ),
    },
    {
      role: 'user',
      content: renderTemplate(
        options.semanticUser || templates.semanticUser,
        vars
      ),
    },
  ];

  const answer = await chatComplete(messages, {
    model: options.model,
    temperature: 0.1,
    maxTokens: 2000,
  });
  const parsed = extractJsonObject(answer);
  return normalizeGroups(parsed.groups, units.length);
}

function materializeGroup(text, sourceId, units, group, config, targetSize, model) {
  const startUnit = units[group[0]];
  const endUnit = units[group[group.length - 1]];
  const piece = text.slice(startUnit.start, endUnit.end);
  if (piece.trim().length <= targetSize * 1.8) {
    const chunk = buildChunk(sourceId, piece, startUnit.start, endUnit.end, {
      headingPath: config.headingPath || [],
      meta: {
        ...(config.meta || {}),
        strategy: 'semantic',
        semanticModel: model || null,
      },
    });
    return chunk ? [chunk] : [];
  }
  return recursiveChunk(piece, sourceId, {
    ...config,
    chunkSize: targetSize,
    headingPath: config.headingPath || [],
    meta: {
      ...(config.meta || {}),
      strategy: 'semantic-fallback',
      semanticModel: model || null,
    },
  }).map((c) => ({
    ...c,
    charStart: startUnit.start + (c.charStart || 0),
    charEnd: startUnit.start + (c.charEnd || piece.length),
  }));
}

async function semanticChunk(text, sourceId, config = {}, onEvent) {
  const targetSize = Number(config.chunkSize || 800);
  const model = config.semanticModel || config.llmModel || undefined;
  const units = splitUnits(text);
  if (!units.length) return [];

  const totalBatches = Math.max(1, Math.ceil(units.length / UNIT_BATCH));
  if (onEvent) {
    onEvent('progress', {
      stage: 'units',
      unitCount: units.length,
      batch: 0,
      totalBatches,
      message: `已拆成 ${units.length} 个语义单元`,
    });
  }

  const chunks = [];
  for (let start = 0, batchIdx = 0; start < units.length; start += UNIT_BATCH, batchIdx += 1) {
    const batch = units.slice(start, start + UNIT_BATCH);
    if (onEvent) {
      onEvent('progress', {
        stage: 'llm',
        batch: batchIdx + 1,
        totalBatches,
        message: `正在调用模型分析第 ${batchIdx + 1}/${totalBatches} 批`,
      });
    }

    let groups;
    let usedFallback = false;
    try {
      groups = await proposeGroups(batch, targetSize, {
        model,
        minSize: config.minSize,
        maxSize: config.maxSize,
        semanticSystem: config.semanticSystem,
        semanticUser: config.semanticUser,
      });
    } catch {
      groups = null;
    }
    if (!groups) {
      groups = packBySize(batch, targetSize);
      usedFallback = true;
    }

    if (onEvent) {
      onEvent('progress', {
        stage: usedFallback ? 'fallback' : 'grouped',
        batch: batchIdx + 1,
        totalBatches,
        message: usedFallback
          ? `第 ${batchIdx + 1} 批模型失败，已回退按长度打包`
          : `第 ${batchIdx + 1} 批已按主题分成 ${groups.length} 组`,
      });
    }

    for (const group of groups) {
      const absoluteGroup = group.map((localIdx) => start + localIdx);
      const made = materializeGroup(text, sourceId, units, absoluteGroup, config, targetSize, model);
      for (const chunk of made) {
        chunks.push(chunk);
        if (onEvent) onEvent('chunk', { chunk, index: chunks.length });
      }
    }
  }

  return chunks;
}

module.exports = {
  splitUnits,
  packBySize,
  normalizeGroups,
  extractJsonObject,
  semanticChunk,
};
