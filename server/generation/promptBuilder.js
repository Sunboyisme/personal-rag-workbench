const { getPromptTemplates } = require('../store');
const { estimateTokens } = require('../utils/tokens');

function renderTemplate(template, vars) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key];
    if (Array.isArray(val)) return val.join(' > ');
    return val == null ? '' : String(val);
  });
}

function buildPrompt(question, chunks, sources, options = {}) {
  const templates = options.templates || getPromptTemplates();
  const tokenBudget = Number(options.tokenBudget || 4000);
  const sourceMap = new Map((sources || []).map((s) => [s.id, s]));

  const contextBlocks = [];
  const truncatedIds = [];
  let usedTokens = estimateTokens(templates.system) + estimateTokens(question) + 50;

  chunks.forEach((chunk, idx) => {
    const source = sourceMap.get(chunk.sourceId);
    const block = renderTemplate(templates.chunkTemplate, {
      index: idx + 1,
      headingPath: chunk.headingPath || [],
      text: chunk.text,
      sourceTitle: source?.title || chunk.sourceId,
      chunkId: chunk.id,
    });
    const blockTokens = estimateTokens(block);
    if (usedTokens + blockTokens > tokenBudget) {
      truncatedIds.push(chunk.id);
      return;
    }
    usedTokens += blockTokens;
    contextBlocks.push({ chunkId: chunk.id, text: block, tokens: blockTokens });
  });

  const contextText = contextBlocks.map((b) => b.text).join('\n\n');
  const user = renderTemplate(templates.userTemplate, { question, context: contextText });

  return {
    system: templates.system,
    contextBlocks,
    user,
    totalTokens: usedTokens + estimateTokens(user),
    budget: tokenBudget,
    truncatedIds,
    messages: [
      { role: 'system', content: templates.system },
      {
        role: 'user',
        content: `${contextText ? `参考资料：\n\n${contextText}\n\n` : ''}${user}`,
      },
    ],
  };
}

module.exports = { buildPrompt, renderTemplate };
