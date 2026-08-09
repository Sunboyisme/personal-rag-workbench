import { useEffect, useState } from 'react';
import { api } from '../api';

const MODES = [
  { id: 'answer', label: '问答输出' },
  { id: 'semantic', label: '语义切分' },
];

function templatesOf(version) {
  if (!version) {
    return {
      system: '',
      chunkTemplate: '',
      userTemplate: '',
      semanticSystem: '',
      semanticUser: '',
    };
  }
  return {
    system: version.system || '',
    chunkTemplate: version.chunkTemplate || '',
    userTemplate: version.userTemplate || '',
    semanticSystem: version.semanticSystem || '',
    semanticUser: version.semanticUser || '',
  };
}

export default function PromptPage() {
  const [mode, setMode] = useState('answer');
  const [versions, setVersions] = useState([]);
  const [selected, setSelected] = useState(null);
  const [activePromptId, setActivePromptId] = useState('');
  const [menuId, setMenuId] = useState(null);
  const [preview, setPreview] = useState(null);
  const [question, setQuestion] = useState('什么是 RAG？');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [diffA, setDiffA] = useState('');
  const [diffB, setDiffB] = useState('');
  const [diffResult, setDiffResult] = useState(null);

  async function load(preferId) {
    const [list, active] = await Promise.all([api.getPrompts(), api.getActivePrompt()]);
    const activeId = active?.activePromptId || list[0]?.id || '';
    const targetId = preferId || activeId;
    setVersions(list);
    setActivePromptId(activeId);
    const next =
      (preferId && list.find((v) => v.id === preferId)) ||
      list.find((v) => v.id === targetId) ||
      list[0] ||
      null;
    setSelected(next);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message || '加载失败'));
  }, []);

  useEffect(() => {
    setPreview(null);
    setMessage('');
  }, [mode]);

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

  function patchField(key, value) {
    if (!selected) return;
    setSelected({ ...selected, [key]: value });
  }

  async function handleDelete(version) {
    setMenuId(null);
    if (versions.length <= 1) {
      alert('至少保留一个提示词版本');
      return;
    }
    if (!window.confirm(`确定删除「${version.name}」？此操作不可撤销。`)) return;
    try {
      const result = await api.deletePrompt(version.id);
      setActivePromptId(result.activePromptId || '');
      const nextPrefer =
        selected?.id === version.id ? result.activePromptId : selected?.id;
      await load(nextPrefer);
      setMessage(`已删除：${version.name}`);
    } catch (error) {
      alert(error.message || '删除失败');
    }
  }

  async function handleCreate() {
    const name = window.prompt('新提示词名称', '未命名提示词');
    if (name === null) return;
    const finalName = name.trim() || '未命名提示词';
    try {
      const created = await api.createPrompt({ name: finalName });
      await load(created.id);
      setMessage(`已新建：${created.name}（编辑后记得保存；设为问答默认才会生效）`);
    } catch (error) {
      alert(error.message || '创建失败');
    }
  }

  async function handleFork(id) {
    const source = versions.find((v) => v.id === id);
    const defaultName = `${source?.name || '提示词'} 副本`;
    const name = window.prompt('新提示词版本名称', defaultName);
    if (name === null) return;
    const finalName = name.trim() || defaultName;
    try {
      const created = await api.forkPrompt(id, finalName);
      await load(created.id);
      setMessage(`已复制为「${created.name}」。编辑后保存，并点「设为问答默认」才会影响问答。`);
      alert(`已复制为「${created.name}」。\n\n请编辑后点击「设为问答默认」，才会影响问答。`);
    } catch (error) {
      alert(error.message || '复制失败');
    }
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setMessage('');
    try {
      const updated = await api.updatePrompt(selected.id, {
        name: selected.name,
        system: selected.system,
        chunkTemplate: selected.chunkTemplate,
        userTemplate: selected.userTemplate,
        semanticSystem: selected.semanticSystem,
        semanticUser: selected.semanticUser,
      });
      await load(updated.id);
      setMessage('已保存');
    } catch (error) {
      setMessage(error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleSetActive() {
    if (!selected) return;
    try {
      await api.setActivePrompt(selected.id);
      setActivePromptId(selected.id);
      setMessage(`已设为问答默认：${selected.name}`);
    } catch (error) {
      setMessage(error.message || '设置失败');
    }
  }

  async function handleDiff() {
    if (!diffA || !diffB) return;
    try {
      const result = await api.diffPrompts(diffA, diffB);
      setDiffResult(result);
    } catch (error) {
      alert(error.message || '对比失败');
    }
  }

  async function runPreview() {
    if (!selected) return;
    setMessage('');
    try {
      const result = await api.previewPrompt({
        question,
        chunks: [
          {
            id: 'sample1',
            sourceId: 'src_sample',
            text: 'RAG（Retrieval-Augmented Generation）是一种结合检索与生成的技术...',
            headingPath: ['知识库', 'RAG 简介'],
          },
        ],
        sources: [{ id: 'src_sample', title: '示例文档' }],
        templates: templatesOf(selected),
        tokenBudget: 4000,
      });
      setPreview(result);
    } catch (error) {
      setMessage(error.message || '预览失败');
    }
  }

  const semanticPreviewSystem = (selected?.semanticSystem || '')
    .replaceAll('{{targetSize}}', '800')
    .replaceAll('{{minSize}}', '400')
    .replaceAll('{{maxSize}}', '1200')
    .replaceAll('{{units}}', '[0] (12字) 示例单元 A\n[1] (18字) 示例单元 B');

  const semanticPreviewUser = (selected?.semanticUser || '')
    .replaceAll('{{targetSize}}', '800')
    .replaceAll('{{minSize}}', '400')
    .replaceAll('{{maxSize}}', '1200')
    .replaceAll('{{units}}', '[0] (12字) 示例单元 A\n[1] (18字) 示例单元 B');

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>提示词版本</h1>
          <p>管理多套提示词，支持复制、对比，并可设为问答默认。</p>
        </div>
      </header>

      <div className="grid-2">
        <section className="card stack">
          <div className="row-between">
            <h3>版本列表</h3>
            <button className="btn secondary btn-compact" type="button" onClick={handleCreate}>
              新建提示词
            </button>
          </div>
          <div className="source-list">
            {versions.map((v) => (
              <div key={v.id} className={`version-row ${selected?.id === v.id ? 'active' : ''}`}>
                <button
                  type="button"
                  className={`source-btn version-row-main ${selected?.id === v.id ? 'active' : ''}`}
                  onClick={() => setSelected(v)}
                >
                  <strong>
                    {v.name}
                    {v.id === activePromptId ? ' · 问答默认' : ''}
                  </strong>
                  <span>{v.id}{v.parentId ? ` (复制自 ${v.parentId})` : ''}</span>
                </button>
                <div className={`collection-menu ${menuId === v.id ? 'open' : ''}`}>
                  <button
                    type="button"
                    className="btn ghost btn-icon collection-menu-trigger"
                    aria-label={`管理 ${v.name}`}
                    aria-expanded={menuId === v.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId((prev) => (prev === v.id ? null : v.id));
                    }}
                  >
                    ⋯
                  </button>
                  {menuId === v.id && (
                    <div className="collection-menu-panel" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        className="collection-menu-item danger"
                        onClick={() => handleDelete(v)}
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
                复制此版本
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleSetActive}
                disabled={selected.id === activePromptId}
              >
                {selected.id === activePromptId ? '当前问答默认' : '设为问答默认'}
              </button>
            </div>
          )}
          <p className="muted small recipe-hint">
            「复制」会新建版本并自动选中；问答实际使用带「问答默认」标记的那一份。
          </p>
        </section>

        {selected && (
          <section className="card stack">
            <h3>编辑 — {selected.name}</h3>
            <label>
              名称
              <input value={selected.name || ''} onChange={(e) => patchField('name', e.target.value)} />
            </label>

            <div className="prompt-mode-switch" role="tablist" aria-label="提示词类型">
              {MODES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === item.id}
                  className={`btn ${mode === item.id ? 'primary' : 'secondary'}`}
                  onClick={() => setMode(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {mode === 'answer' ? (
              <>
                <label>
                  System
                  <textarea
                    rows={10}
                    value={selected.system || ''}
                    onChange={(e) => patchField('system', e.target.value)}
                  />
                </label>
                <label>
                  片段包装 (可用: {'{{index}} {{headingPath}} {{text}} {{sourceTitle}} {{chunkId}}'})
                  <textarea
                    rows={4}
                    value={selected.chunkTemplate || ''}
                    onChange={(e) => patchField('chunkTemplate', e.target.value)}
                  />
                </label>
                <label>
                  User (可用: {'{{question}} {{context}}'})
                  <textarea
                    rows={3}
                    value={selected.userTemplate || ''}
                    onChange={(e) => patchField('userTemplate', e.target.value)}
                  />
                </label>
                <label>
                  预览问题
                  <input value={question} onChange={(e) => setQuestion(e.target.value)} />
                </label>
              </>
            ) : (
              <>
                <p className="muted small">
                  占位符：{'{{targetSize}} {{minSize}} {{maxSize}} {{units}}'}。
                  User 中必须要求返回 JSON：{`{"groups":[[0,1],[2]]}`}。
                </p>
                <label>
                  System
                  <textarea
                    rows={4}
                    value={selected.semanticSystem || ''}
                    onChange={(e) => patchField('semanticSystem', e.target.value)}
                  />
                </label>
                <label>
                  User
                  <textarea
                    rows={10}
                    value={selected.semanticUser || ''}
                    onChange={(e) => patchField('semanticUser', e.target.value)}
                  />
                </label>
              </>
            )}

            <div className="row">
              <button className="btn primary" onClick={handleSave} disabled={saving}>
                {saving ? '保存中...' : '保存此版本'}
              </button>
              {mode === 'answer' && (
                <button className="btn secondary" onClick={runPreview}>预览</button>
              )}
            </div>
            {message && (
              <p className={message.includes('已') ? 'muted' : 'error-text'}>{message}</p>
            )}
          </section>
        )}
      </div>

      {mode === 'answer' ? (
        <section className="card">
          <h3>
            Prompt 预览{' '}
            {preview && <span className="muted">({preview.totalTokens} / {preview.budget} tokens)</span>}
          </h3>
          {preview ? (
            <>
              <h4>System</h4>
              <pre className="code-preview">{preview.system}</pre>
              <h4>User</h4>
              <pre className="code-preview">{preview.messages?.[1]?.content}</pre>
              {preview.truncatedIds?.length > 0 && (
                <p className="muted">截断 chunk: {preview.truncatedIds.join(', ')}</p>
              )}
            </>
          ) : (
            <p className="muted">选择版本后点击预览，查看完整 prompt</p>
          )}
        </section>
      ) : (
        <section className="card stack">
          <h3>语义 Prompt 预览</h3>
          <p className="muted small">用示例参数替换占位符后的效果（不调用模型）。</p>
          <h4>System</h4>
          <pre className="code-preview">{semanticPreviewSystem || '（空）'}</pre>
          <h4>User</h4>
          <pre className="code-preview">{semanticPreviewUser || '（空）'}</pre>
        </section>
      )}

      <section className="card stack">
        <h3>版本 Diff</h3>
        <div className="row">
          <select value={diffA} onChange={(e) => setDiffA(e.target.value)}>
            <option value="">版本 A</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <select value={diffB} onChange={(e) => setDiffB(e.target.value)}>
            <option value="">版本 B</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <button className="btn secondary" onClick={handleDiff}>对比</button>
        </div>
        {diffResult && (
          <div className="diff-list">
            {diffResult.diffs.map((d) => (
              <div key={d.field} className="diff-item">
                <h4>{d.field}</h4>
                <div className="grid-2">
                  <pre>{d.a || '（空）'}</pre>
                  <pre>{d.b || '（空）'}</pre>
                </div>
              </div>
            ))}
            {!diffResult.diffs.length && <p className="muted">两个版本完全相同</p>}
          </div>
        )}
      </section>
    </div>
  );
}
