const { getSettings } = require('../store');
const { joinApiUrl } = require('../utils/apiUrl');

async function rerank(query, documents, options = {}) {
  const settings = getSettings();
  const apiKey = options.apiKey || settings.rerank.apiKey;
  const baseUrl = options.baseUrl || settings.rerank.baseUrl;
  const model = options.model || settings.rerank.model;
  const topN = options.topN || documents.length;

  if (!apiKey) {
    return documents.map((doc, idx) => ({
      index: idx,
      relevance_score: doc.rrfScore ?? doc.score ?? 0,
      document: doc.text,
      chunkId: doc.chunkId,
    }));
  }

  const response = await fetch(joinApiUrl(baseUrl, '/v1/rerank'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      query,
      documents: documents.map((d) => d.text),
      top_n: topN,
      return_documents: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Rerank API 失败: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return data.results.map((r) => ({
    index: r.index,
    relevance_score: r.relevance_score,
    document: r.document?.text || documents[r.index]?.text,
    chunkId: documents[r.index]?.chunkId,
  }));
}

module.exports = { rerank };
