import { useEffect, useState } from 'react';
import { api } from '../api';

function TraceDetail({ trace }) {
  if (!trace) return <p className="muted">加载中…</p>;

  const timings = trace.timings || {};
  const recipe = trace.recipeSnapshot;

  return (
    <div className="stack">
      <section className="card stack">
        <h3>概览</h3>
        <div className="log-meta">
          <span className="pill">{new Date(trace.createdAt).toLocaleString('zh-CN')}</span>
          {recipe?.name && <span className="pill">Recipe · {recipe.name}</span>}
          {trace.collectionId && <span className="pill">Collection · {trace.collectionId}</span>}
          {(timings.rewriteMs != null || timings.embedMs != null) && (
            <span className="pill">
              耗时 rewrite {timings.rewriteMs ?? 0} / embed {timings.embedMs ?? 0} / vec {timings.vectorMs ?? 0} / bm25 {timings.bm25Ms ?? 0} / rerank {timings.rerankMs ?? 0} ms
            </span>
          )}
        </div>
        <div>
          <h4>Query</h4>
          <p className="log-query">{trace.query}</p>
        </div>
      </section>

      <section className="card">
        <h3>候选排名</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>片段</th>
              <th>向量分</th>
              <th>BM25</th>
              <th>RRF</th>
              <th>Rerank</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {(trace.candidates || []).map((c) => (
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
                <td>
                  <span className={`tag ${c.status}`}>{c.status}</span>
                  {c.droppedBy && <span className="muted small"> ({c.droppedBy})</span>}
                </td>
              </tr>
            ))}
            {!trace.candidates?.length && (
              <tr>
                <td colSpan={6} className="muted">无候选记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="grid-2">
        <section className="card">
          <h3>Prompt</h3>
          <pre className="code-preview">
            {trace.prompt?.messages?.[1]?.content || JSON.stringify(trace.prompt, null, 2)}
          </pre>
        </section>
        <section className="card">
          <h3>回答</h3>
          <div className="answer-box">{trace.answer}</div>
          {trace.citations?.length > 0 && (
            <div className="citations">
              {trace.citations.map((c) => (
                <div key={c.chunkId}>[{c.index}] {c.headingPath?.join(' › ') || c.chunkId}</div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default function LogsPage({ navigate, traceId }) {
  const [traces, setTraces] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getTraces()
      .then(setTraces)
      .catch((error) => alert(error.message || '加载日志失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!traceId) {
      setSelected(null);
      return;
    }
    setDetailLoading(true);
    api.getTrace(traceId)
      .then(setSelected)
      .catch((error) => {
        setSelected(null);
        alert(error.message || '日志不存在');
      })
      .finally(() => setDetailLoading(false));
  }, [traceId]);

  function openTrace(id) {
    navigate({ preventDefault: () => {} }, `/admin/logs/${encodeURIComponent(id)}`);
  }

  function backToList() {
    navigate({ preventDefault: () => {} }, '/admin/logs');
  }

  if (traceId) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <h1>执行日志详情</h1>
            <p>单次问答的检索候选、Prompt 与最终回答。</p>
          </div>
          <button className="btn secondary" onClick={backToList}>返回列表</button>
        </header>
        {detailLoading ? <p className="muted">加载中…</p> : <TraceDetail trace={selected} />}
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>执行日志</h1>
          <p>查看每次问答的检索详情、Prompt 组装与回答结果。</p>
        </div>
      </header>

      <section className="card">
        {loading ? (
          <p className="muted">加载中…</p>
        ) : traces.length === 0 ? (
          <p className="muted">暂无执行记录。去问答页提问后会出现在这里。</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>问题</th>
                <th>Recipe</th>
                <th>入选</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => {
                const selectedCount = (t.candidates || []).filter((c) => c.status === 'selected').length;
                return (
                  <tr key={t.id}>
                    <td className="nowrap">{new Date(t.createdAt).toLocaleString('zh-CN')}</td>
                    <td className="clip">{t.query || '（空）'}</td>
                    <td>{t.recipeSnapshot?.name || '-'}</td>
                    <td>{selectedCount}</td>
                    <td>
                      <button type="button" className="btn ghost btn-compact" onClick={() => openTrace(t.id)}>
                        查看详情
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
