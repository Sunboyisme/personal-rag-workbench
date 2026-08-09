import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const TABS = [
  { id: 'dataset', label: '评估集' },
  { id: 'criteria', label: '评估标准' },
  { id: 'run', label: '自动化评估' },
  { id: 'report', label: '评估报告' },
];

function pct(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function num(v, digits = 3) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toFixed(digits);
}

function SummaryCards({ summary }) {
  if (!summary) return null;
  const cards = [
    { label: 'Hit@5', value: pct(summary.avgHitAt5) },
    { label: 'Hit@10', value: pct(summary.avgHitAt10) },
    { label: 'Recall@5', value: pct(summary.avgRecallAt5) },
    { label: 'Recall@10', value: pct(summary.avgRecallAt10) },
    { label: 'MRR', value: num(summary.avgMrr) },
    { label: '命中率', value: pct(summary.hitRate) },
  ];
  if (summary.avgAnswerScore != null) {
    cards.push({ label: '回答分', value: num(summary.avgAnswerScore, 2) });
  }
  return (
    <div className="eval-summary-grid">
      {cards.map((c) => (
        <div key={c.label} className="eval-metric">
          <span className="muted small">{c.label}</span>
          <strong>{c.value}</strong>
        </div>
      ))}
    </div>
  );
}

export default function EvalPage() {
  const [tab, setTab] = useState('dataset');
  const [evalData, setEvalData] = useState({ items: [], runs: [], compares: [] });
  const [criteria, setCriteria] = useState({ retrieval: [], answer: [] });
  const [collections, setCollections] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [chunks, setChunks] = useState([]);
  const [collectionId, setCollectionId] = useState('');
  const [recipeId, setRecipeId] = useState('');
  const [selectedRecipes, setSelectedRecipes] = useState([]);
  const [includeAnswer, setIncludeAnswer] = useState(false);
  const [running, setRunning] = useState(false);
  const [activeRun, setActiveRun] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    question: '',
    referenceAnswer: '',
    tags: '',
    expectedChunkIds: [],
    notes: '',
  });
  const [chunkFilter, setChunkFilter] = useState('');

  async function load() {
    const [ev, cols, recs, crit] = await Promise.all([
      api.getEval(),
      api.getCollections(),
      api.getRecipes(),
      api.getEvalCriteria(),
    ]);
    setEvalData(ev);
    setCollections(cols);
    setRecipes(recs);
    setCriteria(crit);
    const nextCollection = collectionId || cols[0]?.id || '';
    if (!collectionId && cols[0]) setCollectionId(cols[0].id);
    if (!recipeId && recs[0]) setRecipeId(recs[0].id);
    if (!selectedRecipes.length && recs.length) {
      setSelectedRecipes(recs.slice(0, Math.min(2, recs.length)).map((r) => r.id));
    }
    const col = cols.find((c) => c.id === nextCollection) || cols[0];
    if (col?.chunkSetId) {
      const cs = await api.getChunkSet(col.chunkSetId);
      setChunks(cs?.chunks || []);
    } else {
      setChunks([]);
    }
  }

  useEffect(() => {
    load().catch((e) => alert(e.message));
  }, []);

  useEffect(() => {
    async function loadChunks() {
      const col = collections.find((c) => c.id === collectionId);
      if (!col?.chunkSetId) {
        setChunks([]);
        return;
      }
      const cs = await api.getChunkSet(col.chunkSetId);
      setChunks(cs?.chunks || []);
    }
    if (collectionId) loadChunks().catch(() => setChunks([]));
  }, [collectionId, collections]);

  const filteredChunks = useMemo(() => {
    const q = chunkFilter.trim().toLowerCase();
    if (!q) return chunks;
    return chunks.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        String(c.text || '')
          .toLowerCase()
          .includes(q) ||
        (c.headingPath || []).join(' ').toLowerCase().includes(q)
    );
  }, [chunks, chunkFilter]);

  function resetForm() {
    setEditingId(null);
    setForm({
      question: '',
      referenceAnswer: '',
      tags: '',
      expectedChunkIds: [],
      notes: '',
    });
  }

  function startEdit(item) {
    setEditingId(item.id);
    setForm({
      question: item.question || '',
      referenceAnswer: item.referenceAnswer || '',
      tags: (item.tags || []).join(', '),
      expectedChunkIds: item.expectedChunkIds || [],
      notes: item.notes || '',
    });
    setTab('dataset');
  }

  function toggleExpected(chunkId) {
    setForm((prev) => {
      const set = new Set(prev.expectedChunkIds || []);
      if (set.has(chunkId)) set.delete(chunkId);
      else set.add(chunkId);
      return { ...prev, expectedChunkIds: [...set] };
    });
  }

  async function saveItem(event) {
    event.preventDefault();
    const payload = {
      question: form.question.trim(),
      referenceAnswer: form.referenceAnswer,
      notes: form.notes,
      tags: form.tags
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      expectedChunkIds: form.expectedChunkIds,
    };
    if (editingId) await api.updateEvalItem(editingId, payload);
    else await api.addEvalItem(payload);
    resetForm();
    await load();
  }

  async function removeItem(id) {
    if (!confirm('删除该评测题？')) return;
    await api.deleteEvalItem(id);
    if (editingId === id) resetForm();
    await load();
  }

  async function runSingle() {
    if (!collectionId || !recipeId) {
      alert('请选择 Collection 与 Recipe');
      return;
    }
    setRunning(true);
    try {
      const run = await api.runEval({ collectionId, recipeId, includeAnswer });
      setActiveRun(run);
      setMatrix(null);
      setTab('report');
      await load();
    } catch (error) {
      alert(error.message);
    } finally {
      setRunning(false);
    }
  }

  async function runCompare() {
    if (!collectionId || selectedRecipes.length < 2) {
      alert('对比至少勾选 2 个 Recipe');
      return;
    }
    setRunning(true);
    try {
      const compare = await api.compareEval({
        collectionId,
        recipeIds: selectedRecipes,
        includeAnswer,
      });
      setMatrix(compare.matrix || compare);
      setActiveRun(null);
      setTab('report');
      await load();
    } catch (error) {
      alert(error.message);
    } finally {
      setRunning(false);
    }
  }

  function toggleRecipe(id) {
    setSelectedRecipes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function openRun(id) {
    try {
      const run = await api.getEvalRun(id);
      setActiveRun(run);
      setMatrix(null);
      setTab('report');
    } catch (error) {
      alert(error.message);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>评测</h1>
          <p>评估集 → 评估标准 → Agent 自动化跑批 → 报告。用于对比 Recipe 的检索与回答质量。</p>
        </div>
      </header>

      <div className="eval-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`btn ghost ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dataset' && (
        <div className="grid-2">
          <section className="card stack">
              <div className="row-between">
                <h3>{editingId ? '编辑评测题' : '添加评测题'}</h3>
                {editingId && (
                  <button type="button" className="btn ghost" onClick={resetForm}>
                    取消编辑
                  </button>
                )}
              </div>
            <form onSubmit={saveItem} className="stack">
              <label>
                Collection（用于勾选期望片段）
                <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                问题
                <input
                  value={form.question}
                  onChange={(e) => setForm({ ...form, question: e.target.value })}
                  placeholder="例如：你做过哪些设计项目？"
                  required
                />
              </label>
              <label>
                参考答案（可选，开启回答打分时需要）
                <textarea
                  value={form.referenceAnswer}
                  onChange={(e) => setForm({ ...form, referenceAnswer: e.target.value })}
                  rows={3}
                  placeholder="标准事实答案"
                />
              </label>
              <label>
                标签（逗号分隔）
                <input
                  value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="事实, 项目"
                />
              </label>
              <div>
                <div className="row-between">
                  <h4>期望 Chunks（{form.expectedChunkIds.length}）</h4>
                  <input
                    value={chunkFilter}
                    onChange={(e) => setChunkFilter(e.target.value)}
                    placeholder="筛选片段…"
                    style={{ maxWidth: 200 }}
                  />
                </div>
                <div className="eval-chunk-picker">
                  {filteredChunks.map((c) => {
                    const checked = form.expectedChunkIds.includes(c.id);
                    return (
                      <label key={c.id} className={`eval-chunk-item ${checked ? 'selected' : ''}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleExpected(c.id)}
                        />
                        <div>
                          <code className="small">{c.id.slice(0, 12)}</code>
                          {c.headingPath?.length > 0 && (
                            <div className="heading-path">{c.headingPath.join(' › ')}</div>
                          )}
                          <div className="clip">{String(c.text || '').slice(0, 120)}</div>
                        </div>
                      </label>
                    );
                  })}
                  {!filteredChunks.length && <p className="muted">暂无片段，请先建库。</p>}
                </div>
              </div>
              <button className="btn primary" type="submit">
                {editingId ? '保存修改' : '添加到评估集'}
              </button>
            </form>
          </section>

          <section className="card stack">
            <h3>评估集（{evalData.items?.length || 0}）</h3>
            <p className="muted small">
              首次打开会自动种入 6 道关于「覃彦涛能力画像」的样例题（若评估集为空）。
            </p>
            <div className="eval-item-list">
              {(evalData.items || []).map((item) => (
                <article key={item.id} className="eval-item-card">
                  <div className="row-between">
                    <strong>{item.question}</strong>
                    <div className="row">
                      <button type="button" className="btn ghost" onClick={() => startEdit(item)}>
                        编辑
                      </button>
                      <button type="button" className="btn ghost" onClick={() => removeItem(item.id)}>
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="pill-row">
                    {(item.tags || []).map((t) => (
                      <span key={t} className="pill">
                        {t}
                      </span>
                    ))}
                    <span className="pill">期望 {(item.expectedChunkIds || []).length} 段</span>
                  </div>
                  {item.referenceAnswer && (
                    <p className="muted small clip">{item.referenceAnswer}</p>
                  )}
                </article>
              ))}
              {!evalData.items?.length && <p className="muted">评估集为空</p>}
            </div>
          </section>
        </div>
      )}

      {tab === 'criteria' && (
        <div className="grid-2">
          <section className="card stack">
            <h3>检索指标</h3>
            <p className="muted">基于期望 chunk 标注自动计算，无需大模型。</p>
            {(criteria.retrieval || []).map((c) => (
              <div key={c.id} className="eval-criteria-row">
                <strong>{c.name}</strong>
                <p className="muted">{c.desc}</p>
              </div>
            ))}
          </section>
          <section className="card stack">
            <h3>回答指标</h3>
            <p className="muted">跑批时可勾选「生成回答并打分」；无参考答案的题目会跳过打分。</p>
            {(criteria.answer || []).map((c) => (
              <div key={c.id} className="eval-criteria-row">
                <strong>{c.name}</strong>
                <p className="muted">{c.desc}</p>
              </div>
            ))}
          </section>
        </div>
      )}

      {tab === 'run' && (
        <section className="card stack">
          <h3>Agent 自动化评估</h3>
          <p className="muted">
            对评估集逐题执行检索（可选生成回答），汇总 Hit / Recall / MRR，并可对比多个 Recipe。
          </p>
          <div className="grid-2">
            <label>
              Collection
              <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              单次跑批 Recipe
              <select value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeAnswer}
              onChange={(e) => setIncludeAnswer(e.target.checked)}
            />
            生成回答并用 LLM-as-Judge 打分（更慢，需参考答案）
          </label>
          <div>
            <h4>对比 Recipe（可多选）</h4>
            <div className="source-checkboxes">
              {recipes.map((r) => (
                <label key={r.id} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedRecipes.includes(r.id)}
                    onChange={() => toggleRecipe(r.id)}
                  />
                  {r.name}
                </label>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="btn primary" onClick={runSingle} disabled={running}>
              {running ? '跑批中…' : '单配置跑批'}
            </button>
            <button className="btn secondary" onClick={runCompare} disabled={running}>
              {running ? '对比中…' : '多配置对比'}
            </button>
          </div>
          <p className="muted small">当前评估集 {evalData.items?.length || 0} 题。建议先检索-only 跑通，再开回答打分。</p>
        </section>
      )}

      {tab === 'report' && (
        <div className="stack">
          {activeRun && (
            <>
              <section className="card stack">
                <div className="row-between">
                  <div>
                    <h3>报告 · {activeRun.recipeName || activeRun.recipeId || '—'}</h3>
                    <p className="muted small">
                      {new Date(activeRun.createdAt).toLocaleString('zh-CN')} · {activeRun.id}
                      {activeRun.includeAnswer ? ' · 含回答打分' : ' · 仅检索'}
                    </p>
                  </div>
                </div>
                <SummaryCards summary={activeRun.summary} />
              </section>

              {(activeRun.badCases || []).length > 0 && (
                <section className="card stack">
                  <h3>Bad cases</h3>
                  {(activeRun.badCases || []).map((r) => (
                    <article key={r.itemId} className="eval-item-card">
                      <strong>{r.question}</strong>
                      <div className="pill-row">
                        <span className="pill">
                          Hit {r.metrics.hit ? '✓' : '✗'}
                        </span>
                        <span className="pill">MRR {num(r.metrics.mrr)}</span>
                        <span className="pill">Recall@5 {pct(r.metrics.recallAt5)}</span>
                        {r.metrics.answerScore != null && (
                          <span className="pill">回答 {r.metrics.answerScore}/5</span>
                        )}
                      </div>
                      {r.judge?.reason && <p className="muted small">{r.judge.reason}</p>}
                      {r.answer && <p className="small clip">{r.answer}</p>}
                    </article>
                  ))}
                </section>
              )}

              <section className="card">
                <h3>逐题结果</h3>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>问题</th>
                      <th>Hit@5</th>
                      <th>Recall@5</th>
                      <th>MRR</th>
                      <th>回答分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(activeRun.results || []).map((r) => (
                      <tr key={r.itemId}>
                        <td>{r.question}</td>
                        <td>{r.metrics.hitAt5 == null ? '—' : r.metrics.hitAt5 ? '✓' : '✗'}</td>
                        <td>{pct(r.metrics.recallAt5)}</td>
                        <td>{num(r.metrics.mrr)}</td>
                        <td>{r.metrics.answerScore ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </>
          )}

          {matrix && (
            <section className="card">
              <h3>Recipe 对比矩阵</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Recipe</th>
                    <th>Hit@5</th>
                    <th>Recall@5</th>
                    <th>Recall@10</th>
                    <th>MRR</th>
                    <th>命中率</th>
                    <th>回答分</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(matrix) ? matrix : []).map((row) => (
                    <tr key={row.recipeId}>
                      <td>{row.recipeName}</td>
                      <td>{pct(row.summary?.avgHitAt5)}</td>
                      <td>{pct(row.summary?.avgRecallAt5)}</td>
                      <td>{pct(row.summary?.avgRecallAt10)}</td>
                      <td>{num(row.summary?.avgMrr)}</td>
                      <td>{pct(row.summary?.hitRate)}</td>
                      <td>{num(row.summary?.avgAnswerScore, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {!activeRun && !matrix && (
            <section className="card">
              <p className="muted">还没有打开的报告。先去「自动化评估」跑一批，或从下方历史打开。</p>
            </section>
          )}

          <section className="card">
            <h3>历史跑批</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>Recipe</th>
                  <th>题数</th>
                  <th>Recall@5</th>
                  <th>MRR</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(evalData.runs || []).slice(0, 15).map((run) => (
                  <tr key={run.id}>
                    <td>{new Date(run.createdAt).toLocaleString('zh-CN')}</td>
                    <td>{run.recipeName || run.recipeId}</td>
                    <td>{run.summary?.count ?? '—'}</td>
                    <td>{pct(run.summary?.avgRecallAt5)}</td>
                    <td>{num(run.summary?.avgMrr)}</td>
                    <td>
                      <button type="button" className="btn ghost" onClick={() => openRun(run.id)}>
                        查看
                      </button>
                    </td>
                  </tr>
                ))}
                {!evalData.runs?.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      暂无历史
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
