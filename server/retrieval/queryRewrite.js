const { chatComplete } = require('../generation/answerer');

async function rewriteQuery(query, mode = 'off', options = {}) {
  const q = String(query || '').trim();
  const normalized = String(mode || 'off').toLowerCase();
  if (!q || normalized === 'off' || !normalized) {
    return {
      mode: 'off',
      originalQuery: q,
      embedText: q,
      bm25Text: q,
      rerankQuery: q,
      rewriteText: null,
    };
  }

  if (normalized === 'expand' || normalized === 'synonym') {
    const answer = await chatComplete(
      [
        {
          role: 'system',
          content:
            '你是检索查询扩展助手。根据用户短查询，输出同义词、别名、相关中英文关键词，用空格分隔，不要解释，不要标点堆砌。',
        },
        {
          role: 'user',
          content: `原查询：${q}\n请输出扩展关键词（一行）：`,
        },
      ],
      {
        model: options.model,
        temperature: 0.2,
        maxTokens: 120,
      }
    );
    const rewriteText = String(answer || '')
      .replace(/[`"'「」]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const merged = [q, rewriteText].filter(Boolean).join(' ');
    return {
      mode: 'expand',
      originalQuery: q,
      embedText: merged,
      bm25Text: merged,
      rerankQuery: q,
      rewriteText,
    };
  }

  if (normalized === 'hyde') {
    const answer = await chatComplete(
      [
        {
          role: 'system',
          content:
            '你是检索助手。请针对用户问题写一段可能出现在知识库中的假设性答案（80-180字），不要说“根据资料”，不要列点，直接写正文。',
        },
        {
          role: 'user',
          content: q,
        },
      ],
      {
        model: options.model,
        temperature: 0.3,
        maxTokens: 260,
      }
    );
    const rewriteText = String(answer || '').trim();
    return {
      mode: 'hyde',
      originalQuery: q,
      embedText: rewriteText || q,
      bm25Text: q,
      rerankQuery: q,
      rewriteText,
    };
  }

  return {
    mode: 'off',
    originalQuery: q,
    embedText: q,
    bm25Text: q,
    rerankQuery: q,
    rewriteText: null,
  };
}

module.exports = { rewriteQuery };
