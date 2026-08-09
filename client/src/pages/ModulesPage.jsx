import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

const MODULES = [
  {
    key: 'chat',
    title: '对话生成',
    desc: '用于问答页面的流式回复（DeepSeek）',
    fields: [
      { name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { name: 'baseUrl', label: 'Base URL', type: 'text' },
    ],
  },
  {
    key: 'embedding',
    title: '向量化',
    desc: '建库与检索时的 Embedding（硅基流动）',
    fields: [
      { name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { name: 'baseUrl', label: 'Base URL', type: 'text' },
      { name: 'dimensions', label: '维度（可选）', type: 'number', placeholder: '留空使用默认' },
    ],
  },
  {
    key: 'rerank',
    title: '重排序',
    desc: '检索实验室与问答的 Rerank 精排',
    fields: [
      { name: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      { name: 'baseUrl', label: 'Base URL', type: 'text' },
    ],
  },
];

function emptyForm() {
  return {
    chat: { apiKey: '', baseUrl: '', model: '' },
    embedding: { apiKey: '', baseUrl: '', model: '', dimensions: '' },
    rerank: { apiKey: '', baseUrl: '', model: '' },
  };
}

function emptyCatalog() {
  return { chat: [], embedding: [], rerank: [] };
}

function ModelPicker({ value, options, onChange, onAdd, onRemove }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const list = useMemo(() => {
    const ids = new Set(options.map((m) => m.id));
    if (value && !ids.has(value)) {
      return [...options, { id: value, name: value, custom: true, orphan: true }];
    }
    return options;
  }, [options, value]);

  const customModels = list.filter((m) => m.custom);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function onPointerDown(event) {
      if (!event.target.closest?.('.model-picker-menu')) setMenuOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  function handleAdd() {
    const id = draft.trim();
    if (!id) {
      setError('请输入模型名称');
      return;
    }
    if (list.some((m) => m.id === id)) {
      onChange(id);
      setDraft('');
      setError('');
      return;
    }
    onAdd(id);
    onChange(id);
    setDraft('');
    setError('');
  }

  function handleDelete(modelId) {
    setMenuOpen(false);
    const target = list.find((m) => m.id === modelId);
    if (!target?.custom) {
      alert('内置模型不能删除');
      return;
    }
    if (!window.confirm(`确定从列表移除「${modelId}」？`)) return;
    onRemove(modelId);
  }

  const selected = list.find((m) => m.id === value);

  return (
    <div className="model-picker">
      <div className="model-picker-row">
        <label className="model-picker-select">
          模型
          <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
            {!value && <option value="">请选择模型</option>}
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.custom ? `${m.id}（自定义）` : m.name || m.id}
              </option>
            ))}
          </select>
        </label>
        <div className={`collection-menu model-picker-menu ${menuOpen ? 'open' : ''}`}>
          <button
            type="button"
            className="btn ghost btn-icon collection-menu-trigger"
            aria-label="管理当前模型"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="collection-menu-panel" role="menu">
              {selected?.custom ? (
                <button
                  type="button"
                  role="menuitem"
                  className="collection-menu-item danger"
                  onClick={() => handleDelete(selected.id)}
                >
                  删除
                </button>
              ) : (
                <button type="button" role="menuitem" className="collection-menu-item" disabled>
                  内置模型不可删
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="model-picker-add">
        <input
          type="text"
          value={draft}
          placeholder="输入新模型名称后添加"
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <button type="button" className="btn secondary" onClick={handleAdd}>
          添加
        </button>
      </div>

      {customModels.length > 0 && (
        <div className="model-chip-list">
          {customModels.map((m) => (
            <span key={m.id} className="model-chip">
              <span className="model-chip-label">{m.id}</span>
              <button
                type="button"
                className="model-chip-remove"
                aria-label={`删除 ${m.id}`}
                onClick={() => handleDelete(m.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export default function ModulesPage() {
  const [form, setForm] = useState(emptyForm);
  const [models, setModels] = useState(emptyCatalog);
  const [customCatalog, setCustomCatalog] = useState(emptyCatalog);
  const [keySet, setKeySet] = useState({ chat: false, embedding: false, rerank: false });
  const [health, setHealth] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  async function load() {
    const [settings, h] = await Promise.all([api.getSettings(), api.health()]);
    setHealth(h);
    setKeySet({
      chat: settings.chat.apiKeySet,
      embedding: settings.embedding.apiKeySet,
      rerank: settings.rerank.apiKeySet,
    });
    setCustomCatalog({
      chat: settings.modelCatalog?.chat || [],
      embedding: settings.modelCatalog?.embedding || [],
      rerank: settings.modelCatalog?.rerank || [],
    });
    setModels({
      chat: settings.models?.chat || [],
      embedding: settings.models?.embedding || [],
      rerank: settings.models?.rerank || [],
    });
    setForm({
      chat: {
        apiKey: settings.chat.apiKey || '',
        baseUrl: settings.chat.baseUrl || '',
        model: settings.chat.model || '',
      },
      embedding: {
        apiKey: settings.embedding.apiKey || '',
        baseUrl: settings.embedding.baseUrl || '',
        model: settings.embedding.model || '',
        dimensions: settings.embedding.dimensions ?? '',
      },
      rerank: {
        apiKey: settings.rerank.apiKey || '',
        baseUrl: settings.rerank.baseUrl || '',
        model: settings.rerank.model || '',
      },
    });
  }

  useEffect(() => { load(); }, []);

  function updateModule(key, field, value) {
    setForm((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  }

  function handleModelChange(kind, modelId) {
    setForm((prev) => {
      const next = { ...prev, [kind]: { ...prev[kind], model: modelId } };
      if (kind === 'embedding') {
        const meta = models.embedding.find((m) => m.id === modelId);
        if (meta?.dim != null && (prev.embedding.dimensions === '' || prev.embedding.dimensions == null)) {
          next.embedding.dimensions = meta.dim;
        }
      }
      return next;
    });
  }

  function handleAddModel(kind, modelId) {
    setCustomCatalog((prev) => {
      if (prev[kind].includes(modelId)) return prev;
      return { ...prev, [kind]: [...prev[kind], modelId] };
    });
    setModels((prev) => {
      if (prev[kind].some((m) => m.id === modelId)) return prev;
      return {
        ...prev,
        [kind]: [...prev[kind], { id: modelId, name: modelId, custom: true }],
      };
    });
  }

  function handleRemoveModel(kind, modelId) {
    setCustomCatalog((prev) => ({
      ...prev,
      [kind]: prev[kind].filter((id) => id !== modelId),
    }));
    setModels((prev) => ({
      ...prev,
      [kind]: prev[kind].filter((m) => m.id !== modelId),
    }));
    setForm((prev) => {
      if (prev[kind].model !== modelId) return prev;
      const fallback = models[kind].find((m) => m.id !== modelId && !m.custom)?.id
        || models[kind].find((m) => m.id !== modelId)?.id
        || '';
      return { ...prev, [kind]: { ...prev[kind], model: fallback } };
    });
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      const payload = {
        chat: { ...form.chat },
        embedding: {
          ...form.embedding,
          dimensions: form.embedding.dimensions === '' ? null : Number(form.embedding.dimensions),
        },
        rerank: { ...form.rerank },
        modelCatalog: customCatalog,
      };
      await api.saveSettings(payload);
      setMessage('已保存。若修改了 API Key，建议重启后端服务。');
      await load();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>模块管理</h1>
          <p>配置对话、向量化、重排序等服务模块。未配置的模块将无法建库、检索或问答。</p>
        </div>
      </header>

      {health && (
        <section className={`card module-health ${health.ready ? 'ready' : 'warn'}`}>
          <div className="module-health-main">
            <span className={`tag ${health.ready ? 'selected' : 'below_threshold'}`}>
              {health.ready ? '全部就绪' : '待配置'}
            </span>
            <span className="muted">
              Chat {health.apiKeys?.chat ? '✓' : '✗'} · Embedding {health.apiKeys?.embedding ? '✓' : '✗'} · Rerank {health.apiKeys?.rerank ? '✓' : '✗'}
            </span>
          </div>
          {!health.ready && (
            <p className="muted small">
              也可在项目根目录 <code>.env</code> 中配置环境变量，重启 <code>npm run dev</code> 后生效。
            </p>
          )}
        </section>
      )}

      <div className="module-grid">
        {MODULES.map((mod) => (
          <section key={mod.key} className="card stack module-card">
            <div className="module-card-head">
              <div>
                <h3>{mod.title}</h3>
                <p className="muted small">{mod.desc}</p>
              </div>
              <span className={`tag ${keySet[mod.key] ? 'selected' : 'below_threshold'}`}>
                {keySet[mod.key] ? '已配置' : '未配置'}
              </span>
            </div>
            {mod.fields.map((field) => (
              <label key={field.name}>
                {field.label}
                <input
                  type={field.type}
                  value={form[mod.key][field.name] ?? ''}
                  placeholder={field.placeholder}
                  onChange={(e) => updateModule(mod.key, field.name, e.target.value)}
                />
              </label>
            ))}
            <ModelPicker
              value={form[mod.key].model}
              options={models[mod.key] || []}
              onChange={(id) => handleModelChange(mod.key, id)}
              onAdd={(id) => handleAddModel(mod.key, id)}
              onRemove={(id) => handleRemoveModel(mod.key, id)}
            />
          </section>
        ))}
      </div>

      <section className="card stack module-actions">
        <button className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存配置'}
        </button>
        {message && <p className={message.includes('已保存') ? 'muted' : 'error-text'}>{message}</p>}
      </section>
    </div>
  );
}
