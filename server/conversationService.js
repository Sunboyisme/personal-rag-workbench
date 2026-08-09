const { v4: uuidv4 } = require('uuid');
const {
  readSubJson,
  writeSubJson,
  listSubJson,
  deleteSubJson,
} = require('./store');

const DEFAULT_TITLE = '未命名对话';
const TITLE_MAX_LEN = 24;

function makeMessageId() {
  return `msg_${uuidv4().slice(0, 8)}`;
}

function makeConversationId() {
  return `conv_${uuidv4().slice(0, 8)}`;
}

function titleFromQuestion(question) {
  const text = String(question || '').trim().replace(/\s+/g, ' ');
  if (!text) return DEFAULT_TITLE;
  return text.length > TITLE_MAX_LEN ? `${text.slice(0, TITLE_MAX_LEN)}…` : text;
}

function summarize(conv) {
  return {
    id: conv.id,
    title: conv.title || DEFAULT_TITLE,
    collectionId: conv.collectionId || null,
    recipeId: conv.recipeId || null,
    messageCount: (conv.messages || []).length,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  };
}

function listConversations() {
  return listSubJson('conversations')
    .map(summarize)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function getConversation(id) {
  return readSubJson('conversations', id, null);
}

function createConversation({ title, collectionId, recipeId } = {}) {
  const now = new Date().toISOString();
  const conv = {
    id: makeConversationId(),
    title: title?.trim() || DEFAULT_TITLE,
    collectionId: collectionId || null,
    recipeId: recipeId || null,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  writeSubJson('conversations', conv.id, conv);
  return conv;
}

function updateConversation(id, patch = {}) {
  const conv = getConversation(id);
  if (!conv) return null;
  const next = {
    ...conv,
    ...patch,
    id,
    updatedAt: new Date().toISOString(),
  };
  if (patch.title != null) {
    next.title = String(patch.title).trim() || DEFAULT_TITLE;
  }
  writeSubJson('conversations', id, next);
  return next;
}

function deleteConversation(id) {
  const conv = getConversation(id);
  if (!conv) return false;
  deleteSubJson('conversations', id);
  return true;
}

function getRecentHistory(conversationId, limit = 6) {
  const conv = getConversation(conversationId);
  if (!conv?.messages?.length) return [];
  return conv.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .filter((m) => String(m.content || '').trim())
    .slice(-limit)
    .map((m) => ({ role: m.role, content: m.content }));
}

function appendMessages(conversationId, newMessages, { questionForTitle } = {}) {
  const conv = getConversation(conversationId);
  if (!conv) return null;

  const now = new Date().toISOString();
  const stamped = (newMessages || []).map((m) => ({
    id: m.id || makeMessageId(),
    role: m.role,
    content: m.content || '',
    citations: m.citations || [],
    traceId: m.traceId || null,
    createdAt: m.createdAt || now,
  }));

  const isDefaultTitle = !conv.title || conv.title === DEFAULT_TITLE;
  const hasUserBefore = (conv.messages || []).some((m) => m.role === 'user');
  let title = conv.title;
  if (isDefaultTitle && !hasUserBefore && questionForTitle) {
    title = titleFromQuestion(questionForTitle);
  }

  const next = {
    ...conv,
    title,
    messages: [...(conv.messages || []), ...stamped],
    updatedAt: now,
  };
  writeSubJson('conversations', conversationId, next);
  return next;
}

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  getRecentHistory,
  appendMessages,
  titleFromQuestion,
  summarize,
};
