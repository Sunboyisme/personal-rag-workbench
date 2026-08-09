const { v4: uuidv4 } = require('uuid');
const { getEvalSet, saveEvalSet, getSources, getCollection } = require('./store');
const { retrieve } = require('./retrieval/retriever');
const { buildPrompt } = require('./generation/promptBuilder');
const { chat } = require('./generation/answerer');
const recipeService = require('./recipeService');

function recallAtK(retrievedIds, expectedIds, k) {
  if (!expectedIds?.length) return null;
  const top = retrievedIds.slice(0, k);
  const hits = expectedIds.filter((id) => top.includes(id)).length;
  return hits / expectedIds.length;
}

function mrr(retrievedIds, expectedIds) {
  if (!expectedIds?.length) return null;
  for (let i = 0; i < retrievedIds.length; i += 1) {
    if (expectedIds.includes(retrievedIds[i])) return 1 / (i + 1);
  }
  return 0;
}

function hitAtK(retrievedIds, expectedIds, k) {
  if (!expectedIds?.length) return null;
  const top = retrievedIds.slice(0, k);
  return expectedIds.some((id) => top.includes(id));
}

function candidateSortScore(c) {
  return c.rerankScore ?? c.rrfScore ?? c.vectorScore ?? 0;
}

function rankedChunkIds(result) {
  const ranked = [...(result.candidates || [])].sort((a, b) => {
    const fa = a.ranks?.final ?? 9999;
    const fb = b.ranks?.final ?? 9999;
    if (fa !== fb) return fa - fb;
    return candidateSortScore(b) - candidateSortScore(a);
  });
  const ids = ranked.map((c) => c.chunkId).filter(Boolean);
  if (ids.length) return ids;
  return (result.selectedChunks || []).map((c) => c.id);
}

function average(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

async function judgeAnswer(question, answer, referenceAnswer) {
  if (!referenceAnswer?.trim() || !answer?.trim()) {
    return { score: null, reason: '无参考答案或模型答案，跳过打分' };
  }
  const prompt = [
    {
      role: 'system',
      content:
        '你是严格的评测员。根据参考答案评估模型回答。评分 1-5：5=事实准确完整；4=大体正确略有遗漏；3=部分正确；2=明显偏差；1=编造或答非所问。只输出 JSON：{"score":number,"reason":"..."}',
    },
    {
      role: 'user',
      content: `问题：${question}\n\n参考答案：${referenceAnswer}\n\n模型答案：${answer}`,
    },
  ];
  try {
    const raw = await chat(prompt, { temperature: 0 });
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      const score = Number(parsed.score);
      return {
        score: Number.isFinite(score) ? Math.min(5, Math.max(1, score)) : null,
        reason: parsed.reason || '',
      };
    }
  } catch (error) {
    return { score: null, reason: `评测失败：${error.message}` };
  }
  return { score: null, reason: '评测失败：无法解析结果' };
}

async function runEvalItem(item, collectionId, recipe, options = {}) {
  const retrievalConfig = { ...(recipe?.retrieval || {}) };
  const result = await retrieve(item.question, collectionId, retrievalConfig);
  const retrievedIds = rankedChunkIds(result);
  const expected = item.expectedChunkIds || [];
  const metrics = {
    hitAt5: hitAtK(retrievedIds, expected, 5),
    hitAt10: hitAtK(retrievedIds, expected, 10),
    recallAt5: recallAtK(retrievedIds, expected, 5),
    recallAt10: recallAtK(retrievedIds, expected, 10),
    mrr: mrr(retrievedIds, expected),
    hit: hitAtK(retrievedIds, expected, Math.max(5, Number(retrievalConfig.finalTopK || 5))),
  };

  let answer = null;
  let judge = null;
  if (options.includeAnswer) {
    const sources = getSources();
    const prompt = buildPrompt(item.question, result.selectedChunks, sources, {
      ...(recipe?.prompt || {}),
    });
    try {
      answer = await chat(prompt.messages, {
        ...(recipe?.generation || {}),
        temperature: 0.2,
      });
      if (item.referenceAnswer) {
        judge = await judgeAnswer(item.question, answer, item.referenceAnswer);
        metrics.answerScore = judge.score;
      }
    } catch (error) {
      answer = '';
      judge = { score: null, reason: `生成失败：${error.message}` };
    }
  }

  return {
    itemId: item.id,
    question: item.question,
    tags: item.tags || [],
    expectedChunkIds: expected,
    metrics,
    retrievedIds: retrievedIds.slice(0, 20),
    selectedIds: (result.selectedChunks || []).map((c) => c.id),
    answer,
    judge,
  };
}

function summarizeResults(results) {
  return {
    count: results.length,
    withExpected: results.filter((r) => (r.expectedChunkIds || []).length > 0).length,
    avgHitAt5: average(results.map((r) => (r.metrics.hitAt5 ? 1 : r.metrics.hitAt5 === false ? 0 : null))),
    avgHitAt10: average(results.map((r) => (r.metrics.hitAt10 ? 1 : r.metrics.hitAt10 === false ? 0 : null))),
    avgRecallAt5: average(results.map((r) => r.metrics.recallAt5)),
    avgRecallAt10: average(results.map((r) => r.metrics.recallAt10)),
    avgMrr: average(results.map((r) => r.metrics.mrr)),
    hitRate: average(results.map((r) => (r.metrics.hit ? 1 : r.metrics.hit === false ? 0 : null))),
    avgAnswerScore: average(results.map((r) => r.metrics.answerScore)),
    judgedCount: results.filter((r) => r.metrics.answerScore != null).length,
  };
}

function pickBadCases(results, limit = 8) {
  return [...results]
    .map((r) => {
      let badScore = 0;
      if (r.metrics.hit === false) badScore += 3;
      if (r.metrics.mrr === 0) badScore += 2;
      if (typeof r.metrics.answerScore === 'number') badScore += 5 - r.metrics.answerScore;
      return { ...r, badScore };
    })
    .sort((a, b) => b.badScore - a.badScore)
    .slice(0, limit)
    .map(({ badScore, ...rest }) => rest);
}

async function runEvalBatch({
  collectionId,
  recipeId,
  recipe,
  itemIds,
  includeAnswer = false,
  promptId,
}) {
  if (!collectionId) throw new Error('请选择 Collection');
  if (!getCollection(collectionId)) throw new Error(`Collection 不存在: ${collectionId}`);

  const resolvedRecipe = recipe || recipeService.resolveRecipe(recipeId);
  const evalData = getEvalSet();
  const items = (evalData.items || []).filter(
    (item) => !itemIds?.length || itemIds.includes(item.id)
  );
  if (!items.length) throw new Error('评估集为空，请先添加评测题');

  const results = [];
  for (const item of items) {
    results.push(
      await runEvalItem(item, collectionId, resolvedRecipe, { includeAnswer, promptId })
    );
  }

  const summary = summarizeResults(results);
  const run = {
    id: `eval_${uuidv4().slice(0, 8)}`,
    type: 'single',
    collectionId,
    recipeId: resolvedRecipe?.id || recipeId || null,
    recipeName: resolvedRecipe?.name || null,
    includeAnswer: Boolean(includeAnswer),
    criteria: {
      retrieval: ['Hit@5', 'Hit@10', 'Recall@5', 'Recall@10', 'MRR'],
      answer: includeAnswer ? ['LLM-as-Judge 1-5（需参考答案）'] : [],
    },
    summary,
    badCases: pickBadCases(results),
    results,
    createdAt: new Date().toISOString(),
  };

  evalData.runs = evalData.runs || [];
  evalData.runs.unshift(run);
  // 控制体积：历史 runs 只留 30 次
  evalData.runs = evalData.runs.slice(0, 30);
  saveEvalSet(evalData);
  return run;
}

async function runEvalCompare({ collectionId, recipeIds, itemIds, includeAnswer = false }) {
  if (!recipeIds?.length) throw new Error('请选择至少一个 Recipe');
  const matrix = [];
  for (const recipeId of recipeIds) {
    const recipe = recipeService.listRecipes().find((r) => r.id === recipeId);
    if (!recipe) continue;
    const run = await runEvalBatch({
      collectionId,
      recipeId,
      recipe,
      itemIds,
      includeAnswer,
    });
    matrix.push({
      recipeId,
      recipeName: recipe.name,
      runId: run.id,
      summary: run.summary,
    });
  }

  const compare = {
    id: `evalcmp_${uuidv4().slice(0, 8)}`,
    type: 'compare',
    collectionId,
    recipeIds,
    includeAnswer: Boolean(includeAnswer),
    matrix,
    createdAt: new Date().toISOString(),
  };

  const evalData = getEvalSet();
  evalData.compares = evalData.compares || [];
  evalData.compares.unshift(compare);
  evalData.compares = evalData.compares.slice(0, 20);
  saveEvalSet(evalData);
  return compare;
}

function addEvalItem(item) {
  const evalData = getEvalSet();
  const record = {
    id: `evalitem_${uuidv4().slice(0, 8)}`,
    question: item.question,
    expectedChunkIds: item.expectedChunkIds || [],
    referenceAnswer: item.referenceAnswer || '',
    tags: item.tags || [],
    notes: item.notes || '',
    createdAt: new Date().toISOString(),
  };
  evalData.items = evalData.items || [];
  evalData.items.unshift(record);
  saveEvalSet(evalData);
  return record;
}

function updateEvalItem(id, patch) {
  const evalData = getEvalSet();
  const idx = (evalData.items || []).findIndex((i) => i.id === id);
  if (idx < 0) return null;
  const current = evalData.items[idx];
  evalData.items[idx] = {
    ...current,
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  };
  saveEvalSet(evalData);
  return evalData.items[idx];
}

function deleteEvalItem(id) {
  const evalData = getEvalSet();
  evalData.items = (evalData.items || []).filter((i) => i.id !== id);
  saveEvalSet(evalData);
  return { ok: true };
}

function getEvalRun(id) {
  const evalData = getEvalSet();
  return (evalData.runs || []).find((r) => r.id === id) || null;
}

function getEvalCompare(id) {
  const evalData = getEvalSet();
  return (evalData.compares || []).find((c) => c.id === id) || null;
}

function listCriteria() {
  return {
    retrieval: [
      { id: 'hitAt5', name: 'Hit@5', desc: '前 5 条检索结果中是否命中任一期望 chunk' },
      { id: 'hitAt10', name: 'Hit@10', desc: '前 10 条检索结果中是否命中任一期望 chunk' },
      { id: 'recallAt5', name: 'Recall@5', desc: '期望 chunk 在前 5 条中的召回比例' },
      { id: 'recallAt10', name: 'Recall@10', desc: '期望 chunk 在前 10 条中的召回比例' },
      { id: 'mrr', name: 'MRR', desc: '第一个正确 chunk 的排名倒数，越高越好' },
    ],
    answer: [
      {
        id: 'llmJudge',
        name: 'LLM-as-Judge (1-5)',
        desc: '有参考答案时，用对话模型按 rubric 给回答打分',
      },
      {
        id: 'abstain',
        name: '资料不足拒答（人工/后续）',
        desc: '当前版本先记录回答，拒答专项可后续加规则',
      },
    ],
  };
}

function ensureSeedEvalItems() {
  const evalData = getEvalSet();
  if ((evalData.items || []).length > 0) return evalData;
  const seeds = [
    {
      question: '你的个人背景和转行经历是什么？',
      expectedChunkIds: ['07c343a245853e29', 'baf79353106055ad'],
      referenceAnswer:
        '安工程环艺本科，后转 UI 设计，再因兴趣转向 AI 产品；有每日学习复盘习惯，并使用 Coze、Dify 等工具实践。',
      tags: ['简介', '事实'],
    },
    {
      question: '你做过哪些设计项目？',
      expectedChunkIds: ['f7007ee89bd78c50', 'cb90d108f39cbb3d', 'ccfa13587a6abbb7'],
      referenceAnswer: '包括绿城中国 AI 智能体界面、方太制冰饮水机设备端界面、博世家电 IP 动效、校园快送等设计项目。',
      tags: ['项目', '设计'],
    },
    {
      question: '行动喵是什么项目？',
      expectedChunkIds: ['5d3bf9a31b835e8b'],
      referenceAnswer: '行动喵是产品方向的项目之一。',
      tags: ['项目', '产品'],
    },
    {
      question: '你拿过哪些奖项？',
      expectedChunkIds: ['9484062b4b6fd9da'],
      referenceAnswer: '包括中国大学生计算机设计大赛安徽省二等奖、安徽省环境设计大赛三等奖等。',
      tags: ['奖项', '事实'],
    },
    {
      question: '你的 AI 产品能力有哪些？',
      expectedChunkIds: ['b48a3d6513f3f991', '79055594ebeb7a5f'],
      referenceAnswer: '覆盖需求分析、PRD、原型交互，以及 Coze/Dify 等 AI 应用落地能力，目标岗位偏 AI 产品经理。',
      tags: ['能力', '简历'],
    },
    {
      question: '你的 GitHub 是什么？',
      expectedChunkIds: ['00cf18ebb042275a'],
      referenceAnswer: 'GitHub 为 Sunboyisme。',
      tags: ['联系方式', '事实'],
    },
  ].map((item) => ({
    id: `evalitem_${uuidv4().slice(0, 8)}`,
    ...item,
    createdAt: new Date().toISOString(),
  }));

  evalData.items = seeds;
  evalData.runs = evalData.runs || [];
  evalData.compares = evalData.compares || [];
  saveEvalSet(evalData);
  return evalData;
}

module.exports = {
  recallAtK,
  mrr,
  hitAtK,
  judgeAnswer,
  runEvalItem,
  runEvalBatch,
  runEvalCompare,
  addEvalItem,
  updateEvalItem,
  deleteEvalItem,
  getEvalRun,
  getEvalCompare,
  listCriteria,
  ensureSeedEvalItems,
  summarizeResults,
};
