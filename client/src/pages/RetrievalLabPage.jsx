import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';

const DEFAULT_CONFIG = {
  topK: 20,
  finalTopK: 5,
  vectorThreshold: 0.4,
  rerankThreshold: 0.3,
  thresholdMode: 'rerank',
  useBm25: true,
  useRerank: true,
  rrfK: 60,
  vectorWeight: 1,
  bm25Weight: 1,
  rerankTopN: 10,
  minVectorScoreForRerank: '',
  queryRewrite: 'off',
};

const PARAM_HELP = {
  queryRewrite: '用大模型先改写用户问题再检索。关闭=原句；同义扩展=补关键词；HyDE=先写假设答案再向量检索，适合短问句，但更慢更费。',
  useBm25: '开启后同时走关键词检索（BM25），再与向量结果用 RRF 融合，有利于专有名词、编号等精确匹配。',
  topK: '召回阶段每路最多取多少条候选进入融合。越大覆盖越全，但更慢，后续精排压力也更大。',
  rrfK: 'RRF 融合平滑常数。越大，排名靠后的结果衰减越慢，两路结果更容易被一起保留；常用 60。',
  vectorWeight: '混合检索时向量路在 RRF 中的权重。调高更偏语义相似，调低更听关键词路。',
  bm25Weight: '混合检索时 BM25 路在 RRF 中的权重。调高更偏字面匹配；关闭 BM25 时无效。',
  useRerank: '对融合后的候选再用交叉编码器精排，通常更准，但会增加延迟与 API 调用。',
  rerankTopN: '只把融合后的前 N 条送进 Rerank。N 越小越快，但可能漏掉本可排上来的片段。',
  minVectorScoreForRerank: '向量分低于此值的候选不进精排池。用于挡住明显不相关的噪声；留空表示不限制。',
  thresholdMode: '最终入选时用哪一种分数做门槛：向量分、Rerank 分，或关闭阈值只按排名截断。',
  vectorThreshold: '按余弦相似度过滤。低于此分的片段不会进入最终上下文。约 0–1，默认 0.4。',
  rerankThreshold: '按精排相关分过滤。低于此分的片段不会进入最终上下文。标度依模型，约 0–1，默认 0.3。',
  finalTopK: '最终塞进 Prompt 的片段数量上限。太大浪费 token 且易干扰回答，太小可能证据不足。',
};

function ParamHelp({ text }) {
  const btnRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState({});

  function updatePosition() {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const tipWidth = 280;
    const tipMaxHeight = 160;
    const margin = 12;
    let left = rect.left;
    if (left + tipWidth > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - tipWidth - margin);
    }

    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const placeAbove = spaceBelow < 96 && rect.top > spaceBelow;
    if (placeAbove) {
      setStyle({
        left: `${left}px`,
        bottom: `${window.innerHeight - rect.top + 8}px`,
        top: 'auto',
        maxHeight: `${Math.min(tipMaxHeight, rect.top - margin - 8)}px`,
      });
    } else {
      setStyle({
        left: `${left}px`,
        top: `${rect.bottom + 8}px`,
        bottom: 'auto',
        maxHeight: `${Math.min(tipMaxHeight, spaceBelow)}px`,
      });
    }
  }

  function show() {
    updatePosition();
    setOpen(true);
  }

  function hide() {
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return undefined;
    const onReposition = () => updatePosition();
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open]);

  return (
    <span
      className="param-help"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <button
        ref={btnRef}
        type="button"
        className="param-help-btn"
        aria-label="参数说明"
        onClick={(e) => e.preventDefault()}
      >
        ?
      </button>
      {open &&
        createPortal(
          <span className="param-help-tip param-help-tip-portal" role="tooltip" style={style}>
            {text}
          </span>,
          document.body
        )}
    </span>
  );
}

function ParamLabel({ children, helpKey, badge }) {
  return (
    <span className="field-label-row">
      <span>{children}</span>
      {helpKey && PARAM_HELP[helpKey] && <ParamHelp text={PARAM_HELP[helpKey]} />}
      {badge}
    </span>
  );
}

function buildPayloadConfig(config) {
  return {
    ...config,
    minVectorScoreForRerank:
      config.minVectorScoreForRerank === '' || config.minVectorScoreForRerank == null
        ? null
        : Number(config.minVectorScoreForRerank),
    rerankTopN: Number(config.rerankTopN || config.topK),
    vectorThreshold: Number(config.vectorThreshold),
    rerankThreshold: Number(config.rerankThreshold),
  };
}

export default function RetrievalLabPage() {
  const [collections, setCollections] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [query, setQuery] = useState('');
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [result, setResult] = useState(null);
  const [compareResult, setCompareResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [activeRecipeId, setActiveRecipeId] = useState('');
  const [applyTargetId, setApplyTargetId] = useState('');
  const [applyMode, setApplyMode] = useState('update');
  const [newRecipeName, setNewRecipeName] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    Promise.all([api.getCollections(), api.getRecipes(), api.getActiveRecipe()]).then(
      ([cols, recipeList, active]) => {
        setCollections(cols);
        if (cols[0]) setSelectedIds([cols[0].id]);
        setRecipes(recipeList);
        const activeId = active?.activeRecipeId || recipeList[0]?.id || '';
        setActiveRecipeId(activeId);
        setApplyTargetId(activeId);
        const activeRecipe = recipeList.find((r) => r.id === activeId) || recipeList[0];
        if (activeRecipe?.retrieval) {
          setConfig((prev) => ({
            ...prev,
            ...activeRecipe.retrieval,
            minVectorScoreForRerank:
              activeRecipe.retrieval.minVectorScoreForRerank ?? '',
          }));
        }
      }
    );
  }, []);

  function toggleCollection(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function patchConfig(patch) {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'useRerank')) {
        if (patch.useRerank && prev.thresholdMode === 'vector' && prev.useRerank === false) {
          next.thresholdMode = 'rerank';
        }
        if (!patch.useRerank && prev.thresholdMode === 'rerank') {
          next.thresholdMode = 'vector';
        }
      }
      return next;
    });
  }

  async function runPreview() {
    if (!query.trim() || !selectedIds.length) return;
    setLoading(true);
    try {
      const payloadConfig = buildPayloadConfig(config);
      if (selectedIds.length === 1) {
        const res = await api.previewRetrieval({
          query,
          collectionId: selectedIds[0],
          config: payloadConfig,
        });
        setResult(res);
        setCompareResult(null);
      } else {
        const res = await api.compareRetrieval({
          query,
          collectionIds: selectedIds,
          config: payloadConfig,
        });
        setCompareResult(res);
        setResult(null);
      }
    } catch (error) {
      const message = error.message || '检索失败';
      if (message.includes('API_KEY') || message.includes('API Key')) {
        alert(`${message}\n\n请检查项目根目录 .env 是否已配置 API Key，并重启后端（npm run dev）。`);
      } else {
        alert(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function applyToRecipe() {
    if (applyMode === 'update' && !applyTargetId) {
      alert('请选择要更新的 Recipe');
      return;
    }
    if (applyMode === 'create' && !newRecipeName.trim()) {
      alert('请填写新 Recipe 名称');
      return;
    }
    setApplying(true);
    try {
      const res = await api.applyLabToRecipe({
        mode: applyMode,
        recipeId: applyTargetId,
        name: newRecipeName.trim(),
        retrieval: buildPayloadConfig(config),
        setActive: true,
      });
      const list = await api.getRecipes();
      setRecipes(list);
      setActiveRecipeId(res.activeRecipeId);
      setApplyTargetId(res.activeRecipeId);
      setApplyMode('update');
      setNewRecipeName('');
      alert(`已写入「${res.recipe.name}」，并设为问答默认配置。`);
    } catch (error) {
      alert(error.message || '写入失败');
    } finally {
      setApplying(false);
    }
  }

  function renderMeta(res) {
    if (!res) return null;
    const t = res.timings || {};
    const rw = res.queryRewrite || {};
    const cfg = res.config || {};
    return (
      <div className="retrieval-meta">
        {res.embeddingUsed && <span className="pill">{res.embeddingUsed}</span>}
        {typeof res.rerankPoolSize === 'number' && (
          <span className="pill">Rerank 池 {res.rerankPoolSize}</span>
        )}
        {cfg.thresholdMode && cfg.thresholdMode !== 'off' && (
          <span className="pill">
            阈值 {cfg.thresholdMode} ≥ {cfg.activeThreshold ?? cfg.similarityThreshold}
          </span>
        )}
        {cfg.thresholdMode === 'off' && <span className="pill">阈值关闭</span>}
        <span className="pill">
          耗时 rewrite {t.rewriteMs ?? 0} / embed {t.embedMs ?? 0} / vec {t.vectorMs ?? 0} / bm25 {t.bm25Ms ?? 0} / rerank {t.rerankMs ?? 0} ms
        </span>
        {rw.mode && rw.mode !== 'off' && (
          <div className="rewrite-box">
            <strong>Query 改写（{rw.mode}）</strong>
            <pre>{rw.rewriteText || '（空）'}</pre>
            {rw.error && <p className="error-text">改写失败：{rw.error}，已回退原 query</p>}
          </div>
        )}
      </div>
    );
  }

  function renderCandidateTable(candidates, prompt) {
    return (
      <>
        <table className="data-table">
          <thead>
            <tr>
              <th>片段</th>
              <th>向量分</th>
              <th>BM25</th>
              <th>RRF</th>
              <th>Rerank</th>
              <th>排名 V/B/F/Final</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {(candidates || []).map((c) => (
              <tr key={c.chunkId} className={c.status !== 'selected' ? 'muted-row' : ''}>
                <td className="clip">
                  {c.headingPath?.length > 0 && (
                    <div className="heading-path">{c.headingPath.join(' › ')}</div>
                  )}
                  {c.text}
                </td>
                <td>{c.vectorScore?.toFixed(3) ?? '-'}</td>
                <td>{c.bm25Score?.toFixed(3) ?? '-'}</td>
                <td>{c.rrfScore?.toFixed(4) ?? '-'}</td>
                <td>{c.rerankScore?.toFixed(3) ?? '-'}</td>
                <td>{[c.ranks?.vector, c.ranks?.bm25, c.ranks?.fused, c.ranks?.final].map((r) => r ?? '-').join(' / ')}</td>
                <td>
                  <span className={`tag ${c.status}`}>{c.status}</span>
                  {c.droppedBy && <span className="muted small"> ({c.droppedBy})</span>}
                  {c.inRerankPool === false && <span className="muted small"> · 未进精排</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {prompt && (
          <div className="prompt-preview">
            <h4>组装 Prompt ({prompt.totalTokens} / {prompt.budget} tokens)</h4>
            <pre>{prompt.messages?.[1]?.content || ''}</pre>
            {prompt.truncatedIds?.length > 0 && (
              <p className="muted">被截断: {prompt.truncatedIds.join(', ')}</p>
            )}
          </div>
        )}
      </>
    );
  }

  const vectorActive = config.thresholdMode === 'vector';
  const rerankActive = config.thresholdMode === 'rerank';
  const thresholdOff = config.thresholdMode === 'off';
  const activeRecipe = recipes.find((r) => r.id === activeRecipeId);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>检索实验室</h1>
          <p>查看完整候选排名、各阶段分数、淘汰原因与最终 Prompt。调通后可一键写入问答配置。</p>
        </div>
      </header>

      <section className="card stack">
        <label>
          查询
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="输入检索 query..." />
        </label>

        <div className="lab-config">
          <div className="lab-config-section">
            <div className="lab-config-head">
              <h4>1. 查询改写</h4>
              <span className="muted small">可选，改写后再检索</span>
            </div>
            <div className="config-grid config-grid-4">
              <label>
                <ParamLabel helpKey="queryRewrite">改写策略</ParamLabel>
                <select value={config.queryRewrite} onChange={(e) => patchConfig({ queryRewrite: e.target.value })}>
                  <option value="off">关闭</option>
                  <option value="expand">同义扩展</option>
                  <option value="hyde">HyDE 假设答案</option>
                </select>
              </label>
            </div>
          </div>

          <div className="lab-config-section">
            <div className="lab-config-head">
              <h4>2. 召回与融合</h4>
              <label className="checkbox-label lab-inline-toggle">
                <input type="checkbox" checked={config.useBm25} onChange={(e) => patchConfig({ useBm25: e.target.checked })} />
                <span className="field-label-row">
                  启用 BM25 混合
                  <ParamHelp text={PARAM_HELP.useBm25} />
                </span>
              </label>
            </div>
            <div className="config-grid config-grid-4">
              <label>
                <ParamLabel helpKey="topK">TopK</ParamLabel>
                <input type="number" value={config.topK} onChange={(e) => patchConfig({ topK: Number(e.target.value) })} />
              </label>
              <label>
                <ParamLabel helpKey="rrfK">RRF k</ParamLabel>
                <input type="number" value={config.rrfK} onChange={(e) => patchConfig({ rrfK: Number(e.target.value) })} />
              </label>
              <label>
                <ParamLabel helpKey="vectorWeight">向量权重</ParamLabel>
                <input
                  type="number"
                  step="0.1"
                  value={config.vectorWeight}
                  onChange={(e) => patchConfig({ vectorWeight: Number(e.target.value) })}
                />
              </label>
              <label className={!config.useBm25 ? 'field-dim' : ''}>
                <ParamLabel helpKey="bm25Weight">BM25 权重</ParamLabel>
                <input
                  type="number"
                  step="0.1"
                  value={config.bm25Weight}
                  onChange={(e) => patchConfig({ bm25Weight: Number(e.target.value) })}
                  disabled={!config.useBm25}
                />
              </label>
            </div>
          </div>

          <div className="lab-config-section">
            <div className="lab-config-head">
              <h4>3. 精排</h4>
              <label className="checkbox-label lab-inline-toggle">
                <input type="checkbox" checked={config.useRerank} onChange={(e) => patchConfig({ useRerank: e.target.checked })} />
                <span className="field-label-row">
                  启用 Rerank
                  <ParamHelp text={PARAM_HELP.useRerank} />
                </span>
              </label>
            </div>
            <div className={`config-grid config-grid-4 ${!config.useRerank ? 'field-dim' : ''}`}>
              <label>
                <ParamLabel helpKey="rerankTopN">Rerank 前 N 条</ParamLabel>
                <input
                  type="number"
                  value={config.rerankTopN}
                  onChange={(e) => patchConfig({ rerankTopN: Number(e.target.value) })}
                  disabled={!config.useRerank}
                />
              </label>
              <label>
                <ParamLabel helpKey="minVectorScoreForRerank">进池最低向量分</ParamLabel>
                <input
                  type="number"
                  step="0.05"
                  value={config.minVectorScoreForRerank}
                  placeholder="留空不限制"
                  onChange={(e) => patchConfig({ minVectorScoreForRerank: e.target.value })}
                  disabled={!config.useRerank}
                />
              </label>
            </div>
          </div>

          <div className="lab-config-section">
            <div className="lab-config-head">
              <h4>4. 过滤与输出</h4>
              <span className="muted small">向量分与 Rerank 分标度不同，请分开设置</span>
            </div>
            <div className="config-grid config-grid-4">
              <label>
                <ParamLabel helpKey="thresholdMode">阈值作用对象</ParamLabel>
                <select value={config.thresholdMode} onChange={(e) => patchConfig({ thresholdMode: e.target.value })}>
                  <option value="vector">按向量分过滤</option>
                  <option value="rerank" disabled={!config.useRerank}>按 Rerank 分过滤</option>
                  <option value="off">关闭阈值</option>
                </select>
              </label>
              <label className={thresholdOff ? 'field-dim' : ''}>
                <ParamLabel
                  helpKey="vectorThreshold"
                  badge={vectorActive ? <span className="pill pill-live">生效</span> : null}
                >
                  向量阈值
                </ParamLabel>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={config.vectorThreshold}
                  onChange={(e) => patchConfig({ vectorThreshold: Number(e.target.value) })}
                  disabled={thresholdOff}
                />
                <span className="field-hint">余弦相似度 · 约 0–1 · 默认 0.4</span>
              </label>
              <label className={thresholdOff || !config.useRerank ? 'field-dim' : ''}>
                <ParamLabel
                  helpKey="rerankThreshold"
                  badge={rerankActive ? <span className="pill pill-live">生效</span> : null}
                >
                  Rerank 阈值
                </ParamLabel>
                <input
                  type="number"
                  step="0.05"
                  min="0"
                  max="1"
                  value={config.rerankThreshold}
                  onChange={(e) => patchConfig({ rerankThreshold: Number(e.target.value) })}
                  disabled={thresholdOff || !config.useRerank}
                />
                <span className="field-hint">精排相关分 · 约 0–1 · 默认 0.3</span>
              </label>
              <label>
                <ParamLabel helpKey="finalTopK">Final TopK</ParamLabel>
                <input type="number" value={config.finalTopK} onChange={(e) => patchConfig({ finalTopK: Number(e.target.value) })} />
              </label>
            </div>
          </div>

          <div className="lab-config-section">
            <div className="lab-config-head">
              <h4>5. Collection</h4>
              <span className="muted small">多选可并排对比</span>
            </div>
            <div className="source-checkboxes">
              {collections.map((c) => (
                <label key={c.id} className="checkbox-label">
                  <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleCollection(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="lab-config-actions">
          <button className="btn primary" onClick={runPreview} disabled={loading || !query.trim() || !selectedIds.length}>
            {loading ? '检索中...' : '运行检索'}
          </button>
        </div>
      </section>

      <section className="card stack">
        <h3>写入 Recipe / 问答</h3>
        <p className="muted small">
          当前问答默认：{activeRecipe ? `${activeRecipe.name}（${activeRecipe.id}）` : '未设置'}
        </p>
        <div className="config-grid">
          <label>
            写入方式
            <select value={applyMode} onChange={(e) => setApplyMode(e.target.value)}>
              <option value="update">更新已有 Recipe</option>
              <option value="create">另存为新 Recipe</option>
            </select>
          </label>
          {applyMode === 'update' ? (
            <label>
              目标 Recipe
              <select value={applyTargetId} onChange={(e) => setApplyTargetId(e.target.value)}>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}{r.id === activeRecipeId ? '（问答默认）' : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              新 Recipe 名称
              <input
                value={newRecipeName}
                onChange={(e) => setNewRecipeName(e.target.value)}
                placeholder="例如：Lab 平衡版"
              />
            </label>
          )}
        </div>
        <button className="btn secondary" onClick={applyToRecipe} disabled={applying}>
          {applying ? '写入中...' : '应用到问答'}
        </button>
      </section>

      {result && (
        <section className="card">
          <h3>候选表</h3>
          {renderMeta(result)}
          {renderCandidateTable(result.candidates, result.prompt)}
        </section>
      )}

      {compareResult && (
        <div className="compare-grid">
          {compareResult.results.map((r) => (
            <section key={r.collectionId} className="card">
              <h3>{collections.find((c) => c.id === r.collectionId)?.name || r.collectionId}</h3>
              {renderMeta(r)}
              {renderCandidateTable(r.candidates, r.prompt)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
