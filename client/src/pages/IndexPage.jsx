import { useEffect, useState } from 'react';
import { api } from '../api';

export default function IndexPage() {
  const [chunkSets, setChunkSets] = useState([]);
  const [collections, setCollections] = useState([]);
  const [models, setModels] = useState([]);
  const [chunkSetId, setChunkSetId] = useState('');
  const [model, setModel] = useState('BAAI/bge-m3');
  const [dimensions, setDimensions] = useState('');
  const [name, setName] = useState('');
  const [progress, setProgress] = useState(null);
  const [building, setBuilding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [menuId, setMenuId] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getChunkSets(),
      api.getCollections(),
      api.getEmbeddingModels(),
      api.getSettings(),
    ]).then(([cs, cols, mods, settings]) => {
      setChunkSets(cs);
      setCollections(cols);
      setModels(mods);
      if (cs[0]) setChunkSetId(cs[0].id);
      if (settings.embedding?.model) setModel(settings.embedding.model);
      if (
        settings.embedding?.dimensions != null
        && /Qwen\/Qwen3-Embedding/i.test(settings.embedding?.model || '')
      ) {
        setDimensions(String(settings.embedding.dimensions));
      }
    });
  }, []);

  useEffect(() => {
    if (!menuId) return undefined;
    function onDocClick(event) {
      if (!event.target.closest?.('.collection-menu')) {
        setMenuId(null);
      }
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setMenuId(null);
    }
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuId]);

  async function handleBuild() {
    if (!chunkSetId) return;
    setBuilding(true);
    setProgress({ stage: 'starting' });
    try {
      const collection = await api.buildCollection(
        {
          name: name || undefined,
          chunkSetId,
          embeddingConfig: {
            model,
            dimensions: /Qwen\/Qwen3-Embedding/i.test(model) && dimensions
              ? Number(dimensions)
              : null,
          },
        },
        setProgress
      );
      setCollections((prev) => [collection, ...prev]);
      alert(`建库完成: ${collection.name}`);
    } catch (error) {
      alert(error.message);
    } finally {
      setBuilding(false);
      setProgress(null);
    }
  }

  function startRename(collection) {
    setMenuId(null);
    setEditingId(collection.id);
    setEditingName(collection.name || '');
  }

  function cancelRename() {
    setEditingId(null);
    setEditingName('');
  }

  async function saveRename(id) {
    const nextName = editingName.trim();
    if (!nextName) {
      alert('名称不能为空');
      return;
    }
    setBusyId(id);
    try {
      const updated = await api.updateCollection(id, { name: nextName });
      setCollections((prev) => prev.map((item) => (item.id === id ? { ...item, ...updated } : item)));
      cancelRename();
    } catch (error) {
      alert(error.message || '重命名失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(collection) {
    setMenuId(null);
    if (!confirm(`确定删除 Collection「${collection.name}」？\n向量数据也会一并删除，此操作不可恢复。`)) {
      return;
    }
    setBusyId(collection.id);
    try {
      await api.deleteCollection(collection.id);
      setCollections((prev) => prev.filter((item) => item.id !== collection.id));
      if (editingId === collection.id) cancelRename();
    } catch (error) {
      alert(error.message || '删除失败');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>建库</h1>
          <p>选择 ChunkSet 和向量模型，生成可检索的 Collection。检索时将锁定使用建库时的 embedding 模型。</p>
        </div>
      </header>

      <div className="grid-2">
        <section className="card stack">
          <h3>建库配置</h3>
          <label>
            ChunkSet
            <select value={chunkSetId} onChange={(e) => setChunkSetId(e.target.value)}>
              {chunkSets.map((cs) => (
                <option key={cs.id} value={cs.id}>{cs.name} ({cs.stats?.count} 块)</option>
              ))}
            </select>
          </label>
          <label>
            向量模型
            <select
              value={model}
              onChange={(e) => {
                const next = e.target.value;
                setModel(next);
                const meta = models.find((m) => m.id === next);
                if (!/Qwen\/Qwen3-Embedding/i.test(next)) {
                  setDimensions('');
                } else if (meta?.dim && !dimensions) {
                  setDimensions(String(meta.dim));
                }
              }}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.name} (ctx {m.context})</option>
              ))}
            </select>
          </label>
          <label>
            维度 (仅 Qwen3 Embedding 可选)
            <input
              value={dimensions}
              onChange={(e) => setDimensions(e.target.value)}
              placeholder={/Qwen\/Qwen3-Embedding/i.test(model) ? '留空使用默认' : '当前模型无需填写'}
              disabled={!/Qwen\/Qwen3-Embedding/i.test(model)}
            />
          </label>
          <p className="muted small">
            BGE 等模型不要传 dimensions。仅 Qwen3 Embedding 支持自定义维度。
          </p>
          <label>
            Collection 名称
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="可选" />
          </label>
          <button className="btn primary" onClick={handleBuild} disabled={building || !chunkSetId}>
            {building ? '建库中...' : '开始建库'}
          </button>
          {progress && (
            <div className="progress-box">
              <span>阶段: {progress.stage}</span>
              {progress.done != null && <span>{progress.done}/{progress.total}</span>}
            </div>
          )}
        </section>

        <section className="card">
          <h3>已有 Collection ({collections.length})</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>Chunks</th>
                <th>模型</th>
                <th>维度</th>
                <th>建库时间</th>
                <th className="col-actions" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {collections.map((c) => (
                <tr key={c.id}>
                  <td>
                    {editingId === c.id ? (
                      <div className="collection-rename-row">
                        <input
                          className="collection-rename-input"
                          value={editingName}
                          autoFocus
                          disabled={busyId === c.id}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              saveRename(c.id);
                            }
                            if (e.key === 'Escape') cancelRename();
                          }}
                        />
                        <button
                          type="button"
                          className="btn secondary btn-sm"
                          disabled={busyId === c.id}
                          onClick={() => saveRename(c.id)}
                        >
                          保存
                        </button>
                        <button
                          type="button"
                          className="btn ghost btn-sm"
                          disabled={busyId === c.id}
                          onClick={cancelRename}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      c.name
                    )}
                  </td>
                  <td>{c.stats?.chunkCount}</td>
                  <td>{c.embedding?.model || c.stats?.model}</td>
                  <td>{c.embedding?.dim ?? c.stats?.dim}</td>
                  <td>{new Date(c.builtAt).toLocaleString('zh-CN')}</td>
                  <td className="col-actions">
                    <div className={`collection-menu ${menuId === c.id ? 'open' : ''}`}>
                      <button
                        type="button"
                        className="btn ghost btn-icon collection-menu-trigger"
                        aria-label={`管理 ${c.name}`}
                        aria-expanded={menuId === c.id}
                        disabled={busyId === c.id || building || editingId === c.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuId((prev) => (prev === c.id ? null : c.id));
                        }}
                      >
                        ⋯
                      </button>
                      {menuId === c.id && (
                        <div className="collection-menu-panel" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            className="collection-menu-item"
                            onClick={() => startRename(c)}
                          >
                            重命名
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="collection-menu-item danger"
                            onClick={() => handleDelete(c)}
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!collections.length && <p className="muted">尚无 Collection，请先建库。</p>}
        </section>
      </div>
    </div>
  );
}
