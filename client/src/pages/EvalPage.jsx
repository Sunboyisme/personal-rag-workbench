import { useEffect, useState } from 'react';
import { api } from '../api';

export default function EvalPage() {
  const [evalData, setEvalData] = useState({ items: [], runs: [] });
  const [collections, setCollections] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [collectionId, setCollectionId] = useState('');
  const [selectedRecipes, setSelectedRecipes] = useState([]);
  const [form, setForm] = useState({ question: '', expectedChunkIds: '', referenceAnswer: '' });
  const [matrix, setMatrix] = useState(null);
  const [running, setRunning] = useState(false);

  async function load() {
    const [ev, cols, recs] = await Promise.all([
      api.getEval(),
      api.getCollections(),
      api.getRecipes(),
    ]);
    setEvalData(ev);
    setCollections(cols);
    setRecipes(recs);
    if (cols[0]) setCollectionId(cols[0].id);
  }

  useEffect(() => { load(); }, []);

  async function addItem(event) {
    event.preventDefault();
    await api.addEvalItem({
      question: form.question,
      expectedChunkIds: form.expectedChunkIds.split(',').map((s) => s.trim()).filter(Boolean),
      referenceAnswer: form.referenceAnswer,
    });
    setForm({ question: '', expectedChunkIds: '', referenceAnswer: '' });
    await load();
  }

  async function runSingle() {
    if (!collectionId) return;
    setRunning(true);
    try {
      const run = await api.runEval({ collectionId, recipeId: selectedRecipes[0] || recipes[0]?.id });
      await load();
      alert(`完成: Recall@5=${(run.summary.avgRecallAt5 * 100).toFixed(1)}%, MRR=${run.summary.avgMrr.toFixed(3)}`);
    } catch (error) {
      alert(error.message);
    } finally {
      setRunning(false);
    }
  }

  async function runCompare() {
    if (!collectionId || selectedRecipes.length < 2) {
      alert('请选择至少 2 个 Recipe 进行对比');
      return;
    }
    setRunning(true);
    try {
      const result = await api.compareEval({ collectionId, recipeIds: selectedRecipes });
      setMatrix(result.matrix);
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

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>评测</h1>
          <p>管理评测集，跑批计算 Recall@K、MRR，支持多 Recipe 对比矩阵。</p>
        </div>
      </header>

      <div className="grid-2">
        <section className="card stack">
          <h3>添加评测项</h3>
          <form onSubmit={addItem} className="stack">
            <input value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="问题" required />
            <input value={form.expectedChunkIds} onChange={(e) => setForm({ ...form, expectedChunkIds: e.target.value })} placeholder="期望 chunk id，逗号分隔" />
            <textarea value={form.referenceAnswer} onChange={(e) => setForm({ ...form, referenceAnswer: e.target.value })} placeholder="参考答案" rows={3} />
            <button className="btn primary">添加</button>
          </form>
        </section>

        <section className="card stack">
          <h3>跑批</h3>
          <label>
            Collection
            <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="source-checkboxes">
            {recipes.map((r) => (
              <label key={r.id} className="checkbox-label">
                <input type="checkbox" checked={selectedRecipes.includes(r.id)} onChange={() => toggleRecipe(r.id)} />
                {r.name}
              </label>
            ))}
          </div>
          <div className="row">
            <button className="btn primary" onClick={runSingle} disabled={running}>单配置跑批</button>
            <button className="btn secondary" onClick={runCompare} disabled={running}>多配置对比</button>
          </div>
        </section>
      </div>

      <section className="card">
        <h3>评测集 ({evalData.items?.length || 0})</h3>
        <table className="data-table">
          <thead>
            <tr><th>问题</th><th>期望 Chunks</th><th>参考答案</th></tr>
          </thead>
          <tbody>
            {(evalData.items || []).map((item) => (
              <tr key={item.id}>
                <td>{item.question}</td>
                <td>{(item.expectedChunkIds || []).join(', ')}</td>
                <td className="clip">{item.referenceAnswer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {matrix && (
        <section className="card">
          <h3>对比矩阵</h3>
          <table className="data-table">
            <thead>
              <tr><th>Recipe</th><th>Recall@5</th><th>Recall@10</th><th>MRR</th><th>命中率</th></tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.recipeId}>
                  <td>{row.recipeName}</td>
                  <td>{(row.summary.avgRecallAt5 * 100).toFixed(1)}%</td>
                  <td>{(row.summary.avgRecallAt10 * 100).toFixed(1)}%</td>
                  <td>{row.summary.avgMrr.toFixed(3)}</td>
                  <td>{(row.summary.hitRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(evalData.runs || []).length > 0 && (
        <section className="card">
          <h3>历史跑批</h3>
          <table className="data-table">
            <thead>
              <tr><th>时间</th><th>Collection</th><th>Recall@5</th><th>MRR</th></tr>
            </thead>
            <tbody>
              {evalData.runs.slice(0, 10).map((run) => (
                <tr key={run.id}>
                  <td>{new Date(run.createdAt).toLocaleString('zh-CN')}</td>
                  <td>{run.collectionId}</td>
                  <td>{(run.summary.avgRecallAt5 * 100).toFixed(1)}%</td>
                  <td>{run.summary.avgMrr.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
