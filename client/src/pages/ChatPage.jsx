import { useEffect, useRef, useState, Children } from 'react';
import ReactMarkdown from 'react-markdown';
import { api } from '../api';

function createId() {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function withCitationMarks(children) {
  return Children.map(children, (child) => {
    if (typeof child !== 'string') return child;
    return child.split(/(\[\d+\])/g).map((part, index) => {
      if (/^\[\d+\]$/.test(part)) {
        return (
          <span key={`cite-${index}`} className="cite-ref">
            {part}
          </span>
        );
      }
      return part;
    });
  });
}

function ChatMarkdown({ content }) {
  if (!content) return null;
  return (
    <div className="chat-md">
      <ReactMarkdown
        components={{
          p: ({ children }) => <p>{withCitationMarks(children)}</p>,
          li: ({ children }) => <li>{withCitationMarks(children)}</li>,
          strong: ({ children }) => <strong>{withCitationMarks(children)}</strong>,
          em: ({ children }) => <em>{withCitationMarks(children)}</em>,
          h1: ({ children }) => <h3>{withCitationMarks(children)}</h3>,
          h2: ({ children }) => <h3>{withCitationMarks(children)}</h3>,
          h3: ({ children }) => <h4>{withCitationMarks(children)}</h4>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function ChatPage({ navigate }) {
  const [collections, setCollections] = useState([]);
  const [collectionId, setCollectionId] = useState('');
  const [recipes, setRecipes] = useState([]);
  const [recipeId, setRecipeId] = useState('');
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [menuId, setMenuId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 721px)').matches : true
  );
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  async function loadConversations() {
    const list = await api.getConversations();
    setConversations(list);
    return list;
  }

  useEffect(() => {
    Promise.all([api.getCollections(), api.getRecipes(), api.getActiveRecipe(), loadConversations()]).then(
      ([cols, recipeList, active]) => {
        setCollections(cols);
        if (cols[0]) setCollectionId(cols[0].id);
        setRecipes(recipeList);
        setRecipeId(active?.activeRecipeId || recipeList[0]?.id || '');
        if (!cols.length) {
          setMessages([
            {
              id: 'welcome',
              role: 'assistant',
              content:
                '你好，我是你的个人知识库助手。请先在右上角进入「后台配置」导入笔记并建库，然后就可以在这里提问了。',
            },
          ]);
        }
      }
    );
  }, []);

  useEffect(() => {
    function onDocClick(event) {
      if (!event.target.closest?.('.collection-menu')) setMenuId(null);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const syncSidebar = () => {
      if (media.matches) setSidebarOpen(false);
    };
    syncSidebar();
    media.addEventListener('change', syncSidebar);
    return () => media.removeEventListener('change', syncSidebar);
  }, []);

  async function selectConversation(id) {
    if (loading) return;
    if (id === conversationId) return;
    setConversationId(id);
    setMenuId(null);
    if (!id) {
      setMessages([]);
      return;
    }
    const conv = await api.getConversation(id);
    setMessages(conv.messages || []);
    if (conv.collectionId) setCollectionId(conv.collectionId);
    if (conv.recipeId) setRecipeId(conv.recipeId);
  }

  async function startNewConversation() {
    if (loading) return;
    setConversationId(null);
    setMessages([]);
    setMenuId(null);
    inputRef.current?.focus();
  }

  async function handleRename(conv) {
    const next = window.prompt('重命名对话', conv.title);
    if (next == null) return;
    const title = next.trim();
    if (!title) return;
    await api.updateConversation(conv.id, { title });
    await loadConversations();
    setMenuId(null);
  }

  async function handleDelete(conv) {
    if (!confirm(`删除对话「${conv.title}」？`)) return;
    await api.deleteConversation(conv.id);
    const list = await loadConversations();
    if (conversationId === conv.id) {
      if (list[0]) await selectConversation(list[0].id);
      else await startNewConversation();
    }
    setMenuId(null);
  }

  async function ensureConversation() {
    if (conversationId) return conversationId;
    const conv = await api.createConversation({
      collectionId: collectionId || null,
      recipeId: recipeId || null,
    });
    setConversationId(conv.id);
    await loadConversations();
    return conv.id;
  }

  async function handleSend(event) {
    event?.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    if (!collectionId) {
      setMessages((prev) => [
        ...prev,
        { id: createId(), role: 'user', content: question },
        {
          id: createId(),
          role: 'assistant',
          content: '尚未配置知识库。请点击右上角「后台配置」，完成数据源导入和建库后再提问。',
        },
      ]);
      setInput('');
      return;
    }

    const userMsg = { id: createId(), role: 'user', content: question };
    const assistantId = createId();
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);
    setInput('');
    setLoading(true);

    try {
      const activeConversationId = await ensureConversation();
      let traceData = null;
      const result = await api.chat(
        {
          question,
          collectionId,
          recipeId: recipeId || undefined,
          conversationId: activeConversationId,
        },
        {
          onRetrieval: (data) => {
            traceData = data;
          },
          onToken: (text) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + text } : m
              )
            );
          },
        }
      );

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                streaming: false,
                citations: result.citations,
                traceId: result.traceId,
                trace: traceData,
              }
            : m
        )
      );
      if (result.conversationId) setConversationId(result.conversationId);
      await loadConversations();
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, streaming: false, content: `出错了：${error.message}`, error: true }
            : m
        )
      );
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend(event);
    }
  }

  const activeCollection = collections.find((c) => c.id === collectionId);
  const activeRecipe = recipes.find((r) => r.id === recipeId);
  const embeddingLabel = activeCollection
    ? `${activeCollection.embedding?.model || activeCollection.stats?.model || '未知模型'} · ${activeCollection.embedding?.dim ?? activeCollection.stats?.dim ?? '?'}维`
    : null;

  async function handleRecipeChange(nextId) {
    setRecipeId(nextId);
    try {
      await api.setActiveRecipe(nextId);
      if (conversationId) {
        await api.updateConversation(conversationId, { recipeId: nextId });
      }
    } catch (error) {
      console.warn(error);
    }
  }

  async function handleCollectionChange(nextId) {
    setCollectionId(nextId);
    if (conversationId) {
      try {
        await api.updateConversation(conversationId, { collectionId: nextId });
      } catch (error) {
        console.warn(error);
      }
    }
  }

  return (
    <div className={`chat-app ${sidebarOpen ? '' : 'sidebar-collapsed'}`}>
      <aside className={`chat-sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
        <div className="chat-sidebar-head">
          <button
            type="button"
            className="btn primary chat-new-btn"
            onClick={startNewConversation}
            disabled={loading}
          >
            新对话
          </button>
        </div>
        <nav className="chat-conv-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conv-item ${conversationId === conv.id ? 'active' : ''}`}
            >
              <button
                type="button"
                className="conv-item-main"
                onClick={() => selectConversation(conv.id)}
                disabled={loading}
                title={conv.title}
              >
                <span className="conv-title">{conv.title}</span>
                <span className="conv-meta">
                  {new Date(conv.updatedAt).toLocaleDateString('zh-CN')}
                </span>
              </button>
              <div className={`collection-menu ${menuId === conv.id ? 'open' : ''}`}>
                <button
                  type="button"
                  className="btn ghost btn-icon collection-menu-trigger"
                  aria-label="对话操作"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuId(menuId === conv.id ? null : conv.id);
                  }}
                >
                  ⋯
                </button>
                {menuId === conv.id && (
                  <div className="collection-menu-panel" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      className="collection-menu-item"
                      onClick={() => handleRename(conv)}
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="collection-menu-item danger"
                      onClick={() => handleDelete(conv)}
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {!conversations.length && <p className="muted small chat-conv-empty">暂无历史对话</p>}
        </nav>
      </aside>

      {sidebarOpen && (
        <button
          type="button"
          className="chat-sidebar-backdrop"
          aria-label="关闭会话栏"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="chat-main">
        <div className="chat-shell">
          <header className="chat-header">
            <div className="chat-brand">
              <button
                type="button"
                className="btn ghost btn-icon chat-sidebar-toggle"
                onClick={() => setSidebarOpen((v) => !v)}
                aria-label="切换会话栏"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <div className="brand-mark">RAG</div>
              <div>
                <strong>个人知识库</strong>
                {activeCollection && (
                  <span className="chat-subtitle">
                    {activeCollection.name}
                    {embeddingLabel ? ` · ${embeddingLabel}` : ''}
                    {activeRecipe ? ` · ${activeRecipe.name}` : ''}
                  </span>
                )}
              </div>
            </div>
            <div className="chat-header-actions">
              <button
                className="btn ghost btn-icon"
                onClick={() => setShowSettings(!showSettings)}
                title="问答设置"
                aria-label="问答设置"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              </button>
              <button className="btn secondary" onClick={(e) => navigate(e, '/admin/sources')}>
                后台配置
              </button>
            </div>
          </header>

          {showSettings && (
            <div className="chat-settings-panel">
              <label>
                知识库
                <select value={collectionId} onChange={(e) => handleCollectionChange(e.target.value)}>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                检索配置 Recipe
                <select value={recipeId} onChange={(e) => handleRecipeChange(e.target.value)}>
                  {recipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              {activeRecipe?.retrieval && (
                <p className="muted small">
                  TopK {activeRecipe.retrieval.topK} → Final {activeRecipe.retrieval.finalTopK}
                  {activeRecipe.retrieval.thresholdMode === 'off'
                    ? ' · 阈值关'
                    : activeRecipe.retrieval.thresholdMode === 'vector'
                      ? ` · 向量阈值 ${activeRecipe.retrieval.vectorThreshold}`
                      : ` · Rerank 阈值 ${activeRecipe.retrieval.rerankThreshold}`}
                  {activeRecipe.retrieval.useRerank ? ' · Rerank' : ''}
                  {activeRecipe.retrieval.queryRewrite && activeRecipe.retrieval.queryRewrite !== 'off'
                    ? ` · 改写 ${activeRecipe.retrieval.queryRewrite}`
                    : ''}
                </p>
              )}
            </div>
          )}

          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-empty">
                <h2>有什么想了解的？</h2>
                <p>基于你的个人笔记与知识库回答问题，支持多轮对话</p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`chat-message ${msg.role}`}>
                <div className="chat-avatar">{msg.role === 'user' ? '你' : 'AI'}</div>
                <div className="chat-bubble">
                  <div className={`chat-content ${msg.role === 'assistant' ? 'chat-content-md' : ''}`}>
                    {msg.role === 'assistant' ? (
                      <>
                        {msg.content ? (
                          <ChatMarkdown content={msg.content} />
                        ) : (
                          msg.streaming ? '正在思考…' : ''
                        )}
                        {msg.streaming && <span className="chat-cursor" />}
                      </>
                    ) : (
                      <>{msg.content || ''}</>
                    )}
                  </div>
                  {msg.citations?.length > 0 && (
                    <div className="chat-citations">
                      {msg.citations.map((c) => (
                        <span key={c.chunkId} className="pill">
                          [{c.index}] {c.headingPath?.join(' › ') || '引用'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <footer className="chat-input-bar">
            <form onSubmit={handleSend} className="chat-input-form">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                disabled={loading}
              />
              <button className="btn primary chat-send" type="submit" disabled={loading || !input.trim()}>
                {loading ? '…' : '发送'}
              </button>
            </form>
          </footer>
        </div>
      </div>
    </div>
  );
}
