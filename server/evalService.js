const { v4: uuidv4 } = require('uuid');
const { getEvalSet, saveEvalSet } = require('./store');
const { retrieve } = require('./retrieval/retriever');
const { buildPrompt } = require('./generation/promptBuilder');
const { chat } = require('./generation/answerer');

function recallAtK(retrievedIds, expectedIds, k) {
  if (!expectedIds.length) return 0;
  const top = retrievedIds.slice(0, k);
  const hits = expectedIds.filter((id) => top.includes(id)).length;
  return hits / expectedIds.length;
}

function mrr(retrievedIds, expectedIds) {
  for (let i = 0; i < retrievedIds.length; i += 1) {
    if (expectedIds.includes(retrievedIds[i])) return 1 / (i + 1);
  }
  return 0;
}

async function runEvalItem(item, collectionId, recipe) {
  const result = await retrieve(item.question, collectionId, recipe?.retrieval || {});
  const retrievedIds = result.selectedChunks.map((c) => c.id);
  const metrics = {
    recallAt5: recallAtK(retrievedIds, item.expectedChunkIds || [], 5),
    recallAt10: recallAtK(retrievedIds, item.expectedChunkIds || [], 10),
    mrr: mrr(retrievedIds, item.expectedChunkIds || []),
    hit: (item.expectedChunkIds || []).some((id) => retrievedIds.includes(id)),
  };
  return { item, metrics, retrievedIds, candidates: result.candidates };
}

async function runEvalBatch({ collectionId, recipeId, recipe, itemIds }) {
  const evalData = getEvalSet();
  const items = evalData.items.filter(
    (item) => !itemIds?.length || itemIds.includes(item.id)
  );
  const results = [];
  for (const item of items) {
    results.push(await runEvalItem(item, collectionId, recipe));
  }
  const summary = {
    count: results.length,
    avgRecallAt5: results.reduce((s, r) => s + r.metrics.recallAt5, 0) / Math.max(1, results.length),
    avgRecallAt10: results.reduce((s, r) => s + r.metrics.recallAt10, 0) / Math.max(1, results.length),
    avgMrr: results.reduce((s, r) => s + r.metrics.mrr, 0) / Math.max(1, results.length),
    hitRate: results.filter((r) => r.metrics.hit).length / Math.max(1, results.length),
  };

  const run = {
    id: `eval_${uuidv4().slice(0, 8)}`,
    collectionId,
    recipeId,
    summary,
    results,
    createdAt: new Date().toISOString(),
  };
  evalData.runs = evalData.runs || [];
  evalData.runs.unshift(run);
  saveEvalSet(evalData);
  return run;
}

async function judgeAnswer(question, answer, referenceAnswer) {
  const prompt = [
    {
      role: 'system',
      content:
        '你是评测员。根据参考答案，给模型答案打 1-5 分（5最好）。只输出 JSON: {"score": number, "reason": "..."}',
    },
    {
      role: 'user',
      content: `问题：${question}\n参考答案：${referenceAnswer}\n模型答案：${answer}`,
    },
  ];
  try {
    const raw = await chat(prompt, { temperature: 0 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {
    // fallback
  }
  return { score: null, reason: '评测失败' };
}

function addEvalItem(item) {
  const evalData = getEvalSet();
  const record = {
    id: `evalitem_${uuidv4().slice(0, 8)}`,
    question: item.question,
    expectedChunkIds: item.expectedChunkIds || [],
    referenceAnswer: item.referenceAnswer || '',
    createdAt: new Date().toISOString(),
  };
  evalData.items.push(record);
  saveEvalSet(evalData);
  return record;
}

function updateEvalItem(id, patch) {
  const evalData = getEvalSet();
  const idx = evalData.items.findIndex((i) => i.id === id);
  if (idx < 0) return null;
  evalData.items[idx] = { ...evalData.items[idx], ...patch };
  saveEvalSet(evalData);
  return evalData.items[idx];
}

function deleteEvalItem(id) {
  const evalData = getEvalSet();
  evalData.items = evalData.items.filter((i) => i.id !== id);
  saveEvalSet(evalData);
}

module.exports = {
  runEvalItem,
  runEvalBatch,
  judgeAnswer,
  addEvalItem,
  updateEvalItem,
  deleteEvalItem,
  recallAtK,
  mrr,
};
