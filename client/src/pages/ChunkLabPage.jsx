import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const STRATEGIES = [
  { id: 'heading', label: '标题层级' },
  { id: 'recursive', label: '递归切分' },
  { id: 'fixed', label: '固定长度' },
  { id: 'parentChild', label: '父子块 (small-to-big)' },
  { id: 'semantic', label: '语义切分 (LLM)' },
];

export default function ChunkLabPage() {
  const [sources, setSources] = useState([]);
  const [sourceId, setSourceId] = useState('');
  const [text, setText] = useState('');
  const [chatModels, setChatModels] = useState([]);
  const [defaultChatModel, setDefaultChatModel] = useState('');
  const [config, setConfig] = useState({
    strategy: 'heading',
    chunkSize: 800,
    minSize: 400,
    maxSize: 1200,
    overlap: 50,
    childSize: 300,
    parentSize: 1500,
    semanticModel: '',
  });
  const [chunks, setChunks] = useState([]);
  const [stats, setStats] = useState(null);
  const [streamStatus, setStreamStatus] = useState('');
  const [chunkSets, setChunkSets] = useState([]);
  const [saveName, setSaveName] = useState('');
  const [selectedSources, setSelectedSources] = useState([]);
  const [sourceFilter, setSourceFilter] = useState('');
  const [batchReport, setBatchReport] = useState(null);
  const [editingChunkSetId, setEditingChunkSetId] = useState(null);
  const [editingChunkSetName, setEditingChunkSetName] = useState('');
  const [loading, setLoading] = useState(false);
  const [recommending, setRecommending] = useState(false);
  const [recommendation, setRecommendation] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getSources().then((list) => {
      setSources(list);
      if (list.length) {
        setSourceId((prev) => prev || list[0].id);
      }
    });
    api.getChunkSets().then(setChunkSets);
    api.getSettings().then((settings) => {
      const models = settings.models?.chat || [];
      setChatModels(models);
      const current = settings.chat?.model || models[0]?.id || '';
      setDefaultChatModel(current);
      setConfig((prev) => ({
        ...prev,
        semanticModel: prev.semanticModel || current,
      }));
    });
  }, []);

  useEffect(() => {
    if (!sourceId) {
      setText('');
      return;
    }
    api.getSource(sourceId).then((s) => setText(s.content || ''));
  }, [sourceId]);

  const modelOptions = useMemo(() => {
    const list = [...chatModels];
    const selected = config.semanticModel || defaultChatModel;
    if (selected && !list.some((m) => m.id === selected)) {
      list.push({ id: selected, name: selected, custom: true });
    }
    return list;
  }, [chatModels, config.semanticModel, defaultChatModel]);

  useEffect(() => {
    setRecommendation(null);
  }, [sourceId]);

  async function recommend() {
    if (!text.trim()) {
      setError('请先选择有内容的文档');
      return;
    }
    setRecommending(true);
    setError('');
    try {
      const result = await api.recommendChunk({
        text,
        chunkSize: config.chunkSize,
      });
      setRecommendation(result);
    } catch (err) {
      setError(err.message || '推荐失败');
    } finally {
      setRecommending(false);
    }
  }

  function applyRecommendation() {
    if (!recommendation?.suggestedConfig) return;
    setConfig((prev) => ({
      ...prev,
      ...recommendation.suggestedConfig,
      semanticModel: prev.semanticModel || defaultChatModel,
    }));
  }

  async function preview() {
    if (!sourceId) {
      setError('请先选择文档');
      return;
    }
    setLoading(true);
    setError('');
    setChunks([]);
    setStats(null);
    setStreamStatus(config.strategy === 'semantic' ? '准备语义切分…' : '切分中…');
    try {
      const result = await api.previewChunkStream(
        {
          text,
          sourceId,
          config: {
            ...config,
            semanticModel: config.semanticModel || defaultChatModel,
          },
        },
        {
          onProgress: (data) => setStreamStatus(data.message || '切分中…'),
          onChunk: ({ chunk }) => {
            setChunks((prev) => [...prev, chunk]);
            setStreamStatus((prev) => prev || '正在输出切分结果…');
          },
        }
      );
      setChunks(result.chunks || []);
      setStats(result.stats || null);
      setStreamStatus('');
    } catch (err) {
      setError(err.message || '切分失败');
      setStreamStatus('');
    } finally {
      setLoading(false);
    }
  }

  const histogram = useMemo(() => {
    if (!chunks.length) return { buckets: [], max: 0 };
    const buckets = Array(10).fill(0);
    const maxLen = Math.max(...chunks.map((c) => c.text.length), 1);
    chunks.forEach((c) => {
      const idx = Math.min(9, Math.floor((c.text.length / maxLen) * 10));
      buckets[idx] += 1;
    });
    return { buckets, max: Math.max(...buckets, 1) };
  }, [chunks]);

  const filteredSources = useMemo(() => {
    const q = sourceFilter.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter((s) => (s.title || '').toLowerCase().includes(q));
  }, [sources, sourceFilter]);

  async function deleteChunkSet(cs) {
    if (!cs?.id) return;
    if (!confirm(`确定删除 ChunkSet「${cs.name}」？此操作不可恢复。`)) return;
    setLoading(true);
    setError('');
    try {
      try {
        await api.deleteChunkSet(cs.id);
      } catch (err) {
        if (err.status === 409) {
          const names = (err.linked || []).map((c) => c.name).join('、') || '未知 Collection';
          const ok = confirm(
            `「${cs.name}」仍被以下 Collection 引用：\n${names}\n\n强制删除后，这些 Collection 将无法正常检索。是否继续？`
          );
          if (!ok) return;
          await api.deleteChunkSet(cs.id, { force: true });
        } else {
          throw err;
        }
      }
      setChunkSets((prev) => prev.filter((item) => item.id !== cs.id));
      if (editingChunkSetId === cs.id) {
        setEditingChunkSetId(null);
        setEditingChunkSetName('');
      }
    } catch (err) {
      setError(err.message || '删除失败');
      alert(err.message || '删除失败');
    } finally {
      setLoading(false);
    }
  }

  function startRenameChunkSet(cs) {
    setEditingChunkSetId(cs.id);
    setEditingChunkSetName(cs.name || '');
  }

  function cancelRenameChunkSet() {
    setEditingChunkSetId(null);
    setEditingChunkSetName('');
  }

  async function saveRenameChunkSet(id) {
    const name = editingChunkSetName.trim();
    if (!name) {
      alert('名称不能为空');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const updated = await api.updateChunkSet(id, { name });
      setChunkSets((prev) => prev.map((item) => (item.id === id ? { ...item, ...updated } : item)));
      cancelRenameChunkSet();
    } catch (err) {
      setError(err.message || '重命名失败');
      alert(err.message || '重命名失败');
    } finally {
      setLoading(false);
    }
  }

  function toggleSource(id) {
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function selectAllFiltered() {
    setSelectedSources((prev) => {
      const set = new Set(prev);
      filteredSources.forEach((s) => set.add(s.id));
      return [...set];
    });
  }

  function clearSelection() {
    setSelectedSources([]);
  }

  async function saveChunkSet() {
    if (!selectedSources.length) {
      alert('请选择至少一个数据源');
      return;
    }
    setLoading(true);
    setError('');
    setBatchReport(null);
    try {
      const cs = await api.createChunkSet({
        name: saveName || `ChunkSet ${new Date().toLocaleString('zh-CN')}`,
        sourceIds: selectedSources,
        config: {
          ...config,
          semanticModel: config.semanticModel || defaultChatModel,
        },
      });
      setChunkSets((prev) => [cs, ...prev]);
      alert(`已保存 ChunkSet: ${cs.name} (${cs.stats.count} 块)`);
    } catch (err) {
      setError(err.message || '保存失败');
      alert(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  }

  async function autoSaveByRecommend() {
    const ids = selectedSources.length ? selectedSources : sources.map((s) => s.id);
    if (!ids.length) {
      alert('没有可处理的文档');
      return;
    }
    const tip = selectedSources.length
      ? `将按推荐策略，为已选 ${ids.length} 篇文档自动分组并创建多个 ChunkSet。\n\n批量时「语义切分」会降级为「递归切分」以避免大量调用模型。是否继续？`
      : `未勾选文档时，将对全部 ${ids.length} 篇自动分组建 ChunkSet。\n\n批量时「语义切分」会降级为「递归切分」。是否继续？`;
    if (!confirm(tip)) return;

    setLoading(true);
    setError('');
    setBatchReport(null);
    try {
      const report = await api.autoChunkSetsByRecommend({
        sourceIds: ids,
        chunkSize: config.chunkSize,
        namePrefix: saveName || undefined,
        downgradeSemantic: true,
        semanticModel: config.semanticModel || defaultChatModel,
      });
      setBatchReport(report);
      const list = await api.getChunkSets();
      setChunkSets(list);
      alert(`已创建 ${report.created.length} 个 ChunkSet，覆盖 ${report.totalSources} 篇文档`);
    } catch (err) {
      setError(err.message || '批量保存失败');
      alert(err.message || '批量保存失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>切分实验室</h1>
          <p>实时预览切分策略，查看块长度分布与重叠区域。</p>
        </div>
      </header>

      <div className="grid-3">
        <section className="card stack">
          <h3>输入</h3>
          <label>
            选择文档
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              disabled={!sources.length}
            >
              {!sources.length && <option value="">暂无文档</option>}
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </label>
          <textarea
            rows={12}
            value={text}
            readOnly
            placeholder={sources.length ? '选择文档后显示内容' : '请先在数据源页导入文档'}
          />
          <h4>策略参数</h4>
          <label>
            策略
            <select value={config.strategy} onChange={(e) => setConfig({ ...config, strategy: e.target.value })}>
              {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>

          {config.strategy === 'heading' && (
            <>
              <label>
                单节最大长度
                <input
                  type="number"
                  value={config.chunkSize}
                  onChange={(e) => setConfig({ ...config, chunkSize: Number(e.target.value) })}
                />
              </label>
              <p className="muted small">
                按 Markdown 标题切段。某节超过该长度时，才会回退到递归切分；标题层级本身不使用「重叠」。
              </p>
            </>
          )}

          {config.strategy === 'fixed' && (
            <>
              <label>
                块大小
                <input
                  type="number"
                  value={config.chunkSize}
                  onChange={(e) => setConfig({ ...config, chunkSize: Number(e.target.value) })}
                />
              </label>
              <label>
                重叠
                <input
                  type="number"
                  value={config.overlap}
                  onChange={(e) => setConfig({ ...config, overlap: Number(e.target.value) })}
                />
              </label>
              <p className="muted small">按固定字符数滑窗切分，相邻块保留重叠。</p>
            </>
          )}

          {config.strategy === 'recursive' && (
            <>
              <label>
                目标块大小
                <input
                  type="number"
                  value={config.chunkSize}
                  onChange={(e) => setConfig({ ...config, chunkSize: Number(e.target.value) })}
                />
              </label>
              <label>
                重叠
                <input
                  type="number"
                  value={config.overlap}
                  onChange={(e) => setConfig({ ...config, overlap: Number(e.target.value) })}
                />
              </label>
              <p className="muted small">优先在段落/换行/句号等边界切开；超长再递归，并带重叠。</p>
            </>
          )}

          {config.strategy === 'parentChild' && (
            <>
              <label>
                父块大小
                <input
                  type="number"
                  value={config.parentSize}
                  onChange={(e) => setConfig({ ...config, parentSize: Number(e.target.value) })}
                />
              </label>
              <label>
                子块大小
                <input
                  type="number"
                  value={config.childSize}
                  onChange={(e) => setConfig({ ...config, childSize: Number(e.target.value) })}
                />
              </label>
              <label>
                子块重叠
                <input
                  type="number"
                  value={config.overlap}
                  onChange={(e) => setConfig({ ...config, overlap: Number(e.target.value) })}
                />
              </label>
              <p className="muted small">
                先按标题切父块（受父块大小限制），再在父块内固定长度切子块。检索用子块，回答可带回父块。
              </p>
            </>
          )}

          {config.strategy === 'semantic' && (
            <>
              <label>
                语义切分模型
                <select
                  value={config.semanticModel || defaultChatModel}
                  onChange={(e) => setConfig({ ...config, semanticModel: e.target.value })}
                >
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.custom ? `${m.id}（自定义）` : m.name || m.id}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                目标块大小
                <input
                  type="number"
                  value={config.chunkSize}
                  onChange={(e) => {
                    const chunkSize = Number(e.target.value);
                    setConfig((prev) => ({
                      ...prev,
                      chunkSize,
                      minSize: Math.round(chunkSize * 0.5),
                      maxSize: Math.round(chunkSize * 1.5),
                    }));
                  }}
                />
              </label>
              <label>
                最小块 (minSize)
                <input
                  type="number"
                  value={config.minSize}
                  onChange={(e) => setConfig({ ...config, minSize: Number(e.target.value) })}
                />
              </label>
              <label>
                最大块 (maxSize)
                <input
                  type="number"
                  value={config.maxSize}
                  onChange={(e) => setConfig({ ...config, maxSize: Number(e.target.value) })}
                />
              </label>
              <p className="muted small">
                调用大模型按主题分组；失败时回退按长度打包。改目标块大小会按 50%–150% 重置 min/max，也可单独微调。不使用「重叠」。
              </p>
            </>
          )}
          <div className="row chunk-actions">
            <button
              className="btn secondary"
              onClick={recommend}
              disabled={recommending || loading || !text.trim()}
            >
              {recommending ? '分析中...' : '推荐策略'}
            </button>
            <button className="btn primary" onClick={preview} disabled={loading || !sourceId || !text.trim()}>
              {loading ? '切分中...' : '预览切分'}
            </button>
          </div>
          {streamStatus && <p className="muted small">{streamStatus}</p>}
          {error && <p className="error-text">{error}</p>}

          {recommendation && (
            <div className="recommend-box">
              <div className="recommend-head">
                <strong>推荐：{recommendation.label}</strong>
                <span className={`tag ${recommendation.confidence === 'high' ? 'selected' : 'below_threshold'}`}>
                  置信度 {recommendation.confidence === 'high' ? '高' : recommendation.confidence === 'low' ? '低' : '中'}
                </span>
              </div>
              <p className="muted small">{recommendation.summary}</p>
              <h4>原因</h4>
              <ul className="recommend-list">
                {(recommendation.reasons || []).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              {recommendation.warnings?.length > 0 && (
                <>
                  <h4>注意</h4>
                  <ul className="recommend-list">
                    {recommendation.warnings.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </>
              )}
              {recommendation.alternatives?.length > 0 && (
                <>
                  <h4>备选</h4>
                  <ul className="recommend-list">
                    {recommendation.alternatives.map((alt) => (
                      <li key={alt.strategy}>
                        <strong>{alt.label}</strong>：{alt.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {recommendation.analysis && (
                <p className="muted small">
                  文档画像：{recommendation.analysis.length} 字 · 标题 {recommendation.analysis.headingCount} ·
                  段落 {recommendation.analysis.paragraphCount} · 超长节 {recommendation.analysis.oversizedSections}
                </p>
              )}
              <button type="button" className="btn secondary" onClick={applyRecommendation}>
                应用该策略
              </button>
            </div>
          )}
        </section>

        <section className="card span-2">
          <div className="chunk-results-header">
            <h3>
              切分结果{' '}
              {stats
                ? <span className="muted">({stats.count} 块, 均长 {stats.avgLen}, P95 {stats.p95Len})</span>
                : loading && chunks.length > 0
                  ? <span className="muted">(已输出 {chunks.length} 块…)</span>
                  : null}
            </h3>
          </div>
          {histogram.buckets.length > 0 && histogram.max > 0 && (
            <div className="histogram-wrap">
              <span className="histogram-label muted">块长度分布</span>
              <div className="histogram" aria-hidden="true">
                {histogram.buckets.map((count, i) => (
                  <div
                    key={i}
                    className="bar"
                    style={{ height: `${Math.max(8, (count / histogram.max) * 100)}%` }}
                    title={`${count} 块`}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="chunk-list">
            {chunks.map((chunk, idx) => (
              <div key={`${chunk.id}-${idx}`} className="chunk-card">
                <div className="chunk-meta">
                  <span className="pill">#{idx + 1}</span>
                  <span className="pill">{chunk.text.length} 字</span>
                  <span className="pill">{chunk.tokens} tokens</span>
                  {chunk.meta?.strategy === 'semantic' && <span className="pill accent">语义</span>}
                  {chunk.parentId && <span className="pill accent">子块 → {chunk.parentId.slice(0, 8)}</span>}
                </div>
                {chunk.headingPath?.length > 0 && (
                  <div className="heading-path">{chunk.headingPath.join(' > ')}</div>
                )}
                <pre className="chunk-text">{chunk.text}</pre>
              </div>
            ))}
            {!chunks.length && (
              <p className="muted">{loading ? (streamStatus || '切分中…') : '点击「预览切分」查看结果'}</p>
            )}
          </div>
        </section>
      </div>

      <section className="card stack">
        <h3>保存为 ChunkSet</h3>
        <p className="muted small">
          手动保存：勾选文档后用上方同一套策略。文档很多时用「按推荐策略批量建」自动分组。
        </p>
        <div className="source-batch-toolbar">
          <input
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            placeholder="搜索文档标题"
          />
          <button type="button" className="btn ghost btn-sm" onClick={selectAllFiltered} disabled={loading || !filteredSources.length}>
            全选{sourceFilter.trim() ? '筛选结果' : ''}
          </button>
          <button type="button" className="btn ghost btn-sm" onClick={clearSelection} disabled={loading || !selectedSources.length}>
            取消全选
          </button>
          <span className="muted small">已选 {selectedSources.length}/{sources.length}</span>
        </div>
        <div className="source-checkboxes source-checkboxes-scroll">
          {filteredSources.map((s) => (
            <label key={s.id} className="checkbox-label">
              <input type="checkbox" checked={selectedSources.includes(s.id)} onChange={() => toggleSource(s.id)} />
              {s.title}
            </label>
          ))}
          {!filteredSources.length && <p className="muted small">没有匹配的文档</p>}
        </div>
        <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="ChunkSet 名称 / 批量前缀（可选）" />
        <div className="row chunk-actions">
          <button className="btn primary" onClick={saveChunkSet} disabled={loading}>
            {loading ? '处理中...' : '另存为 ChunkSet'}
          </button>
          <button className="btn secondary" onClick={autoSaveByRecommend} disabled={loading || !sources.length}>
            {loading ? '处理中...' : '按推荐策略批量建'}
          </button>
        </div>
        {batchReport && (
          <div className="recommend-box">
            <div className="recommend-head">
              <strong>批量结果</strong>
              <span className="tag selected">{batchReport.created.length} 个 ChunkSet</span>
            </div>
            <p className="muted small">
              共处理 {batchReport.totalSources} 篇
              {batchReport.downgradeSemantic ? '；语义切分已降级为递归切分' : ''}
            </p>
            <ul className="recommend-list">
              {batchReport.created.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>：{item.sourceCount} 篇 → {item.chunkCount} 块
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="chunkset-list">
          <h4>已有 ChunkSet ({chunkSets.length})</h4>
          {!chunkSets.length && <p className="muted small">暂无 ChunkSet</p>}
          {chunkSets.map((cs) => (
            <div key={cs.id} className="chunkset-item">
              <div className="chunkset-item-main">
                {editingChunkSetId === cs.id ? (
                  <input
                    className="chunkset-rename-input"
                    value={editingChunkSetName}
                    autoFocus
                    disabled={loading}
                    onChange={(e) => setEditingChunkSetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        saveRenameChunkSet(cs.id);
                      }
                      if (e.key === 'Escape') cancelRenameChunkSet();
                    }}
                  />
                ) : (
                  <strong>{cs.name}</strong>
                )}
                <span className="muted small">
                  {cs.stats?.count ?? 0} 块
                  {cs.chunkingConfig?.strategy ? ` · ${cs.chunkingConfig.strategy}` : ''}
                  {cs.sourceIds?.length ? ` · ${cs.sourceIds.length} 篇文档` : ''}
                </span>
              </div>
              <div className="chunkset-item-actions">
                {editingChunkSetId === cs.id ? (
                  <>
                    <button
                      type="button"
                      className="btn secondary btn-sm"
                      disabled={loading}
                      onClick={() => saveRenameChunkSet(cs.id)}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      disabled={loading}
                      onClick={cancelRenameChunkSet}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn ghost btn-sm"
                      disabled={loading}
                      onClick={() => startRenameChunkSet(cs)}
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      className="btn danger btn-sm"
                      disabled={loading}
                      onClick={() => deleteChunkSet(cs)}
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
