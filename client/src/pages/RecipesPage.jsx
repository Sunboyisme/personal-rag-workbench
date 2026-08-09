import { useEffect, useState } from 'react';
import { api } from '../api';

export default function RecipesPage() {
  const [recipes, setRecipes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activeRecipeId, setActiveRecipeId] = useState('');
  const [menuId, setMenuId] = useState(null);
  const [diffA, setDiffA] = useState('');
  const [diffB, setDiffB] = useState('');
  const [diffResult, setDiffResult] = useState(null);

  async function load(preferId) {
    const [list, active] = await Promise.all([api.getRecipes(), api.getActiveRecipe()]);
    const activeId = active?.activeRecipeId || list[0]?.id || '';
    setRecipes(list);
    setActiveRecipeId(activeId);
    const next =
      (preferId && list.find((r) => r.id === preferId)) ||
      list.find((r) => r.id === activeId) ||
      list[0] ||
      null;
    setSelected(next);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!menuId) return undefined;
    function onPointerDown(event) {
      if (!event.target.closest?.('.collection-menu')) {
        setMenuId(null);
      }
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setMenuId(null);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuId]);

  async function handleFork(id) {
    const source = recipes.find((r) => r.id === id);
    const defaultName = `${source?.name || '配置'} 副本`;
    const name = window.prompt('新配置名称', defaultName);
    if (name === null) return;
    const finalName = name.trim() || defaultName;
    try {
      const created = await api.forkRecipe(id, finalName);
      await load(created.id);
      alert(`已复制为「${created.name}」。\n\n请编辑后点击「设为问答默认」，才会影响问答。`);
    } catch (error) {
      alert(error.message || '复制失败');
    }
  }

  async function handleDelete(recipe) {
    setMenuId(null);
    if (recipes.length <= 1) {
      alert('至少保留一个 Recipe');
      return;
    }
    if (!window.confirm(`确定删除「${recipe.name}」？此操作不可撤销。`)) return;
    try {
      const result = await api.deleteRecipe(recipe.id);
      setActiveRecipeId(result.activeRecipeId || '');
      const nextPrefer = selected?.id === recipe.id ? result.activeRecipeId : selected?.id;
      await load(nextPrefer);
    } catch (error) {
      alert(error.message || '删除失败');
    }
  }

  async function handleSave() {
    if (!selected) return;
    await api.updateRecipe(selected.id, selected);
    await load(selected.id);
    alert('已保存');
  }

  async function handleSetActive() {
    if (!selected) return;
    await api.setActiveRecipe(selected.id);
    setActiveRecipeId(selected.id);
    alert(`已设为问答默认：${selected.name}`);
  }

  async function handleDiff() {
    if (!diffA || !diffB) return;
    const result = await api.diffRecipes(diffA, diffB);
    setDiffResult(result);
  }

  function updateSection(section, key, value) {
    setSelected({
      ...selected,
      [section]: { ...selected[section], [key]: value },
    });
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>实验配置 Recipe</h1>
          <p>管理具名配置版本，支持复制、对比，并可设为问答默认。</p>
        </div>
      </header>

      <div className="grid-2">
        <section className="card stack">
          <h3>Recipe 列表</h3>
          <div className="source-list">
            {recipes.map((r) => (
              <div key={r.id} className={`version-row ${selected?.id === r.id ? 'active' : ''}`}>
                <button
                  type="button"
                  className={`source-btn version-row-main ${selected?.id === r.id ? 'active' : ''}`}
                  onClick={() => setSelected(r)}
                >
                  <strong>
                    {r.name}
                    {r.id === activeRecipeId ? ' · 问答默认' : ''}
                  </strong>
                  <span>{r.id} {r.parentId && `(复制自 ${r.parentId})`}</span>
                </button>
                <div className={`collection-menu ${menuId === r.id ? 'open' : ''}`}>
                  <button
                    type="button"
                    className="btn ghost btn-icon collection-menu-trigger"
                    aria-label={`管理 ${r.name}`}
                    aria-expanded={menuId === r.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId((prev) => (prev === r.id ? null : r.id));
                    }}
                  >
                    ⋯
                  </button>
                  {menuId === r.id && (
                    <div className="collection-menu-panel" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="collection-menu-item danger"
                        onClick={() => handleDelete(r)}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          {selected && (
            <div className="recipe-list-actions">
              <button type="button" className="btn secondary" onClick={() => handleFork(selected.id)}>
                复制此配置
              </button>
              <button type="button" className="btn primary" onClick={handleSetActive} disabled={selected.id === activeRecipeId}>
                {selected.id === activeRecipeId ? '当前问答默认' : '设为问答默认'}
              </button>
            </div>
          )}
          <p className="muted small recipe-hint">
            「复制」会新建一份配置并自动选中；问答实际使用带「问答默认」标记的那一份。
          </p>
        </section>

        {selected && (
          <section className="card stack">
            <h3>编辑 — {selected.name}</h3>
            <label>名称 <input value={selected.name} onChange={(e) => setSelected({ ...selected, name: e.target.value })} /></label>

            <h4>切分</h4>
            <label>策略
              <select value={selected.chunking?.strategy} onChange={(e) => updateSection('chunking', 'strategy', e.target.value)}>
                <option value="heading">heading</option>
                <option value="recursive">recursive</option>
                <option value="fixed">fixed</option>
                <option value="parentChild">parentChild</option>
                <option value="semantic">semantic (LLM)</option>
              </select>
            </label>
            <label>块大小 <input type="number" value={selected.chunking?.chunkSize} onChange={(e) => updateSection('chunking', 'chunkSize', Number(e.target.value))} /></label>
            {selected.chunking?.strategy === 'semantic' && (
              <label>语义模型 <input value={selected.chunking?.semanticModel || ''} onChange={(e) => updateSection('chunking', 'semanticModel', e.target.value)} placeholder="如 deepseek-chat" /></label>
            )}

            <h4>Embedding</h4>
            <label>模型 <input value={selected.embedding?.model} onChange={(e) => updateSection('embedding', 'model', e.target.value)} /></label>

            <h4>检索</h4>
            <label>TopK <input type="number" value={selected.retrieval?.topK} onChange={(e) => updateSection('retrieval', 'topK', Number(e.target.value))} /></label>
            <label>Final TopK <input type="number" value={selected.retrieval?.finalTopK} onChange={(e) => updateSection('retrieval', 'finalTopK', Number(e.target.value))} /></label>
            <label>阈值作用对象
              <select value={selected.retrieval?.thresholdMode || 'rerank'} onChange={(e) => updateSection('retrieval', 'thresholdMode', e.target.value)}>
                <option value="vector">按向量分</option>
                <option value="rerank">按 Rerank 分</option>
                <option value="off">关闭</option>
              </select>
            </label>
            <label>
              向量阈值
              <input type="number" step="0.05" value={selected.retrieval?.vectorThreshold ?? 0.4} onChange={(e) => updateSection('retrieval', 'vectorThreshold', Number(e.target.value))} />
              <span className="field-hint">余弦相似度，约 0–1；默认 0.4</span>
            </label>
            <label>
              Rerank 阈值
              <input type="number" step="0.05" value={selected.retrieval?.rerankThreshold ?? 0.3} onChange={(e) => updateSection('retrieval', 'rerankThreshold', Number(e.target.value))} />
              <span className="field-hint">精排相关分，约 0–1；默认 0.3</span>
            </label>
            <label>Rerank 前 N <input type="number" value={selected.retrieval?.rerankTopN ?? 10} onChange={(e) => updateSection('retrieval', 'rerankTopN', Number(e.target.value))} /></label>
            <label>Query 改写
              <select value={selected.retrieval?.queryRewrite || 'off'} onChange={(e) => updateSection('retrieval', 'queryRewrite', e.target.value)}>
                <option value="off">关闭</option>
                <option value="expand">同义扩展</option>
                <option value="hyde">HyDE</option>
              </select>
            </label>
            <label className="checkbox-label"><input type="checkbox" checked={selected.retrieval?.useBm25 !== false} onChange={(e) => updateSection('retrieval', 'useBm25', e.target.checked)} /> 混合检索 BM25</label>
            <label className="checkbox-label"><input type="checkbox" checked={selected.retrieval?.useRerank !== false} onChange={(e) => updateSection('retrieval', 'useRerank', e.target.checked)} /> Rerank</label>

            <h4>生成</h4>
            <label>Temperature <input type="number" step="0.1" value={selected.generation?.temperature} onChange={(e) => updateSection('generation', 'temperature', Number(e.target.value))} /></label>

            <button type="button" className="btn primary" onClick={handleSave}>保存配置</button>
          </section>
        )}
      </div>

      <section className="card stack">
        <h3>配置 Diff</h3>
        <div className="row">
          <select value={diffA} onChange={(e) => setDiffA(e.target.value)}>
            <option value="">Recipe A</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={diffB} onChange={(e) => setDiffB(e.target.value)}>
            <option value="">Recipe B</option>
            {recipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <button type="button" className="btn secondary" onClick={handleDiff}>对比</button>
        </div>
        {diffResult && (
          <div className="diff-list">
            {diffResult.diffs.map((d) => (
              <div key={d.section} className="diff-item">
                <h4>{d.section}</h4>
                <div className="grid-2">
                  <pre>{JSON.stringify(d.a, null, 2)}</pre>
                  <pre>{JSON.stringify(d.b, null, 2)}</pre>
                </div>
              </div>
            ))}
            {!diffResult.diffs.length && <p className="muted">两个配置完全相同</p>}
          </div>
        )}
      </section>
    </div>
  );
}
