import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { filterImportFiles, formatImportSummary } from '../importUtils';

function setupFolderInput(input) {
  if (!input) return;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
  input.setAttribute('mozdirectory', '');
}

export default function SourcesPage() {
  const [sources, setSources] = useState([]);
  const [selected, setSelected] = useState(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [importProgress, setImportProgress] = useState(null);
  const [importSummary, setImportSummary] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setupFolderInput(folderInputRef.current);
  }, []);

  async function load() {
    const list = await api.getSources();
    setSources(list);
    setSelectedIds((prev) => prev.filter((id) => list.some((s) => s.id === id)));
  }

  useEffect(() => { load(); }, []);

  async function selectSource(source) {
    setSelected(source);
    const detail = await api.getSource(source.id);
    setContent(detail.content || '');
  }

  async function importFiles(files, preSkipped = []) {
    const totalScanned = files.length + preSkipped.length;

    if (!totalScanned) {
      alert('未选择任何文件，请重新选择文件夹');
      return;
    }

    if (!files.length) {
      const summary = formatImportSummary({ created: [], skipped: [], failed: [] }, preSkipped);
      setImportSummary(summary);
      setImportStatus('');
      alert(`${summary}\n\n未找到可导入的 .md / .txt / .pdf / .docx 文件。`);
      return;
    }

    setLoading(true);
    setImportSummary('');
    setImportStatus(`已扫描 ${totalScanned} 个文件，正在导入 ${files.length} 篇…`);
    setImportProgress({ done: 0, total: files.length });
    try {
      const result = await api.uploadSources(files, setImportProgress);
      const summary = formatImportSummary(result, preSkipped);
      setImportSummary(summary);
      setImportStatus('');
      if (result.failed?.length) {
        console.warn('导入失败文件:', result.failed);
        alert(`${summary}\n\n有 ${result.failed.length} 个文件导入失败，详见浏览器控制台。`);
      } else if ((result.created?.length || 0) === 0) {
        alert(summary);
      }
      await load();
    } catch (error) {
      setImportStatus('');
      alert(`导入失败：${error.message}\n\n如刚更新过代码，请重启 npm run dev。`);
    } finally {
      setLoading(false);
      setImportProgress(null);
    }
  }

  async function handleUpload(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    const { importable, skipped } = filterImportFiles(files);
    await importFiles(importable, skipped);
  }

  async function handleFolderUpload(event) {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) {
      alert('未读取到文件夹内容，请换一个文件夹重试');
      return;
    }
    const { importable, skipped } = filterImportFiles(files);
    await importFiles(importable, skipped);
  }

  function openFolderPicker() {
    if (loading) return;
    const input = folderInputRef.current;
    if (!input) return;
    setupFolderInput(input);
    input.value = '';
    input.click();
  }

  function openFilePicker() {
    if (loading) return;
    fileInputRef.current?.click();
  }

  function toggleBatchMode() {
    setBatchMode((prev) => {
      if (prev) setSelectedIds([]);
      return !prev;
    });
  }

  function toggleSelected(id) {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    ));
  }

  function selectAll() {
    setSelectedIds(sources.map((s) => s.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  async function handleBatchDelete() {
    if (!selectedIds.length) return;
    if (!confirm(`确定删除选中的 ${selectedIds.length} 篇文档？此操作不可恢复。`)) return;
    setLoading(true);
    try {
      await api.batchSources('delete', selectedIds);
      if (selected && selectedIds.includes(selected.id)) {
        setSelected(null);
        setContent('');
      }
      setSelectedIds([]);
      await load();
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('确定删除此数据源？')) return;
    await api.deleteSource(id);
    if (selected?.id === id) {
      setSelected(null);
      setContent('');
    }
    await load();
  }

  function startRename(source, event) {
    event.stopPropagation();
    setEditingId(source.id);
    setEditingTitle(source.title);
  }

  function cancelRename() {
    setEditingId(null);
    setEditingTitle('');
  }

  async function saveRename(id) {
    const title = editingTitle.trim();
    if (!title) {
      alert('标题不能为空');
      return;
    }
    try {
      const updated = await api.updateSource(id, { title });
      if (selected?.id === id) setSelected(updated);
      setEditingId(null);
      setEditingTitle('');
      await load();
    } catch (error) {
      alert(error.message);
    }
  }

  function handleRenameKeyDown(event, id) {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRename(id);
    }
    if (event.key === 'Escape') {
      cancelRename();
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>数据源管理</h1>
          <p>支持批量导入整个笔记文件夹。自动导入 .md / .txt / .pdf / .docx，跳过图片与附件。</p>
        </div>
      </header>

      <div className="grid-2">
        <section className="card stack">
          <h3>导入</h3>
          <button
            type="button"
            className="upload-zone folder-zone"
            onClick={openFolderPicker}
            disabled={loading}
          >
            <strong>选择笔记文件夹（推荐）</strong>
            <span>批量导入整个目录，自动跳过图片、.obsidian 等</span>
          </button>
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden-file-input"
            onChange={handleFolderUpload}
          />
          <button
            type="button"
            className="upload-zone"
            onClick={openFilePicker}
            disabled={loading}
          >
            <span>或选择多个文件上传</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.markdown,.txt,.pdf,.docx"
            className="hidden-file-input"
            onChange={handleUpload}
          />
          {importStatus && (
            <div className="progress-box">{importStatus}</div>
          )}
          {importProgress && (
            <div className="progress-box">
              导入中 {importProgress.done}/{importProgress.total}
            </div>
          )}
          {importSummary && (
            <p className="import-summary">{importSummary}</p>
          )}
        </section>

        <section className="card">
          <div className="source-list-header">
            <h3>文档列表 ({sources.length})</h3>
            <div className="source-list-actions">
              {sources.length > 0 && (
                <button
                  type="button"
                  className={`btn ghost ${batchMode ? 'active' : ''}`}
                  onClick={toggleBatchMode}
                  disabled={loading}
                >
                  {batchMode ? '退出批量' : '批量操作'}
                </button>
              )}
            </div>
          </div>

          {batchMode && sources.length > 0 && (
            <div className="batch-toolbar">
              <span className="batch-toolbar-count">已选 {selectedIds.length}/{sources.length}</span>
              <div className="batch-toolbar-actions">
                <button type="button" className="btn ghost btn-sm" onClick={selectAll} disabled={loading}>全选</button>
                <button type="button" className="btn ghost btn-sm" onClick={clearSelection} disabled={loading || !selectedIds.length}>取消全选</button>
                <button
                  type="button"
                  className="btn danger btn-sm"
                  onClick={handleBatchDelete}
                  disabled={loading || !selectedIds.length}
                >
                  批量删除
                </button>
              </div>
            </div>
          )}

          <div className="source-list">
            {sources.map((s) => (
              <div
                key={s.id}
                className={`source-item ${selected?.id === s.id ? 'active' : ''} ${selectedIds.includes(s.id) ? 'checked' : ''}`}
              >
                {batchMode && (
                  <label className="source-check">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(s.id)}
                      onChange={() => toggleSelected(s.id)}
                      disabled={loading}
                    />
                  </label>
                )}
                <button type="button" className="source-btn" onClick={() => selectSource(s)}>
                  {editingId === s.id ? (
                    <input
                      className="source-rename-input"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => handleRenameKeyDown(e, s.id)}
                      onBlur={() => saveRename(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <strong>{s.title}</strong>
                  )}
                  <span>{s.charCount} 字 · {s.tags?.join(', ') || '无标签'}</span>
                </button>
                <div className="source-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={(e) => startRename(s, e)}
                    disabled={editingId === s.id}
                  >
                    重命名
                  </button>
                  <button className="btn ghost danger" onClick={() => handleDelete(s.id)}>删除</button>
                </div>
              </div>
            ))}
            {!sources.length && <p className="muted">暂无数据源，请先导入。</p>}
          </div>
        </section>
      </div>

      {selected && (
        <section className="card">
          <h3>原文预览 — {selected.title}</h3>
          {selected.links?.length > 0 && (
            <div className="pill-row">
              {selected.links.map((l) => (
                <span key={l.raw} className="pill">[[{l.target}]]</span>
              ))}
            </div>
          )}
          <pre className="code-preview">{content}</pre>
        </section>
      )}
    </div>
  );
}
