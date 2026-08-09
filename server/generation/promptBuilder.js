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
  const history = Array.isArray(options.history) ? options.history : [];
  const sourceMap = new Map((sources || []).map((s) => [s.id, s]));

  const contextBlocks = [];
  const truncatedIds = [];
  let historyTokens = history.reduce(
    (sum, m) => sum + estimateTokens(m.content || '') + 8,
    0
  );
  let usedTokens =
    estimateTokens(templates.system) + estimateTokens(question) + historyTokens + 50;

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

  const messages = [{ role: 'system', content: templates.system }];

  history.forEach((m) => {
    if (!m?.content?.trim()) return;
    messages.push({ role: m.role, content: m.content });
  });

  messages.push({
    role: 'user',
    content: `${contextText ? `参考资料：\n\n${contextText}\n\n` : ''}${user}`,
  });

  return {
    system: templates.system,
    contextBlocks,
    user,
    history,
    totalTokens: usedTokens + estimateTokens(user),
    budget: tokenBudget,
    truncatedIds,
    messages,
  };
}

module.exports = { buildPrompt, renderTemplate };
