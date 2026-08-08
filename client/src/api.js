const API = '/api';

function consumeSseChunks(buffer, onEvent) {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() || '';
  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split('\n');
    const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
    const dataLine = lines.find((l) => l.startsWith('data:'))?.slice(5).trim();
    if (!dataLine) continue;
    const data = JSON.parse(dataLine);
    onEvent(event, data);
  }
  return rest;
}

async function readSseStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    if (done) break;
    buffer = consumeSseChunks(buffer, onEvent);
  }
  // 流结束时处理最后一个 event（可能没有结尾的 \n\n）
  if (buffer.trim()) {
    consumeSseChunks(`${buffer}\n\n`, onEvent);
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `请求失败: ${response.status}`);
  }
  return response.json();
}

export const api = {
  health: () => request('/health'),
  getSources: () => request('/sources'),
  getSource: (id) => request(`/sources/${id}`),
  deleteSource: (id) => request(`/sources/${id}`, { method: 'DELETE' }),
  updateSource: (id, body) => request(`/sources/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  repairSourceTitles: (ids) => request('/sources/repair-titles', {
    method: 'POST',
    body: JSON.stringify(ids ? { ids } : {}),
  }),
  batchSources: async (action, ids) => {
    try {
      return await request('/sources/batch', {
        method: 'POST',
        body: JSON.stringify({ action, ids }),
      });
    } catch (error) {
      // 兼容未重启的旧后端：降级为逐个调用已有接口
      const stale = /404|Not Found|未知批量操作/i.test(error.message || '');
      if (!stale) throw error;
      if (action === 'delete') {
        for (const id of ids) await request(`/sources/${id}`, { method: 'DELETE' });
        return { action, affected: ids.length, fallback: true };
      }
      if (action === 'repairTitles') {
        return request('/sources/repair-titles', {
          method: 'POST',
          body: JSON.stringify({ ids }),
        });
      }
      throw error;
    }
  },
  pasteSource: (body) => request('/sources/paste', { method: 'POST', body: JSON.stringify(body) }),
  uploadSources: async (files, onProgress) => {
    const BATCH = 50;
    const total = files.length;
    const aggregate = { created: [], skipped: [], failed: [] };
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const form = new FormData();
      for (const file of batch) {
        const name = file.webkitRelativePath || file.name;
        form.append('files', file, name);
      }
      const response = await fetch(`${API}/sources/upload`, { method: 'POST', body: form });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || '上传失败');
      }
      const data = await response.json();
      aggregate.created.push(...(data.created || []));
      aggregate.skipped.push(...(data.skipped || []));
      aggregate.failed.push(...(data.failed || []));
      if (onProgress) onProgress({ done: Math.min(i + batch.length, total), total });
    }
    return aggregate;
  },
  previewChunk: (body) => request('/chunk/preview', { method: 'POST', body: JSON.stringify(body) }),
  recommendChunk: (body) => request('/chunk/recommend', { method: 'POST', body: JSON.stringify(body) }),
  previewChunkStream: (body, handlers = {}) =>
    new Promise((resolve, reject) => {
      fetch(`${API}/chunk/preview/stream`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(async (response) => {
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            reject(new Error(err.error || '切分失败'));
            return;
          }
          let finished = false;
          await readSseStream(response, (event, data) => {
            if (event === 'progress' && handlers.onProgress) handlers.onProgress(data);
            if (event === 'chunk' && handlers.onChunk) handlers.onChunk(data);
            if (event === 'done' && !finished) {
              finished = true;
              resolve(data);
            }
            if (event === 'error') reject(new Error(data.error || '切分失败'));
          });
          if (!finished) reject(new Error('切分流式未完成'));
        })
        .catch(reject);
    }),
  getChunkSets: () => request('/chunksets'),
  getChunkSet: (id) => request(`/chunksets/${id}`),
  createChunkSet: (body) => request('/chunksets', { method: 'POST', body: JSON.stringify(body) }),
  updateChunkSet: (id, body) => request(`/chunksets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteChunkSet: async (id, { force = false } = {}) => {
    const response = await fetch(`${API}/chunksets/${id}${force ? '?force=1' : ''}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `请求失败: ${response.status}`);
      error.status = response.status;
      error.linked = data.linked || [];
      throw error;
    }
    return data;
  },
  autoChunkSetsByRecommend: (body) =>
    request('/chunksets/auto-by-recommend', { method: 'POST', body: JSON.stringify(body) }),
  getCollections: () => request('/collections'),
  updateCollection: (id, body) => request(`/collections/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCollection: (id) => request(`/collections/${id}`, { method: 'DELETE' }),
  buildCollection: (body, onProgress) =>
    new Promise((resolve, reject) => {
      fetch(`${API}/collections/build`, {
        method: 'POST',
        headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then(async (response) => {
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            reject(new Error(err.error || '建库失败'));
            return;
          }
          let finished = false;
          await readSseStream(response, (event, data) => {
            if (event === 'progress' && onProgress) onProgress(data);
            if (event === 'progress' && data.stage === 'done' && data.collection && !finished) {
              finished = true;
              resolve(data.collection);
            }
            if (event === 'done' && !finished) {
              finished = true;
              resolve(data);
            }
            if (event === 'error') reject(new Error(data.error));
          });
          if (!finished) reject(new Error('建库未完成，请刷新页面查看是否已生成 Collection'));
        })
        .catch(reject);
    }),
  previewRetrieval: (body) => request('/retrieval/preview', { method: 'POST', body: JSON.stringify(body) }),
  compareRetrieval: (body) => request('/retrieval/compare', { method: 'POST', body: JSON.stringify(body) }),
  getPrompts: () => request('/prompts'),
  getActivePrompt: () => request('/prompts/active'),
  setActivePrompt: (promptId) =>
    request('/prompts/active', { method: 'PUT', body: JSON.stringify({ promptId }) }),
  createPrompt: (body) => request('/prompts', { method: 'POST', body: JSON.stringify(body) }),
  forkPrompt: (id, name) =>
    request(`/prompts/${id}/fork`, { method: 'POST', body: JSON.stringify({ name }) }),
  updatePrompt: (id, body) => request(`/prompts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deletePrompt: (id) => request(`/prompts/${id}`, { method: 'DELETE' }),
  diffPrompts: (a, b) => request(`/prompts/diff?a=${a}&b=${b}`),
  savePrompts: (body) => request('/prompts', { method: 'PUT', body: JSON.stringify(body) }),
  previewPrompt: (body) => request('/prompts/preview', { method: 'POST', body: JSON.stringify(body) }),
  getRecipes: () => request('/recipes'),
  createRecipe: (body) => request('/recipes', { method: 'POST', body: JSON.stringify(body) }),
  forkRecipe: (id, name) => request(`/recipes/${id}/fork`, { method: 'POST', body: JSON.stringify({ name }) }),
  updateRecipe: (id, body) => request(`/recipes/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  diffRecipes: (a, b) => request(`/recipes/diff?a=${a}&b=${b}`),
  getActiveRecipe: () => request('/recipes/active'),
  setActiveRecipe: (recipeId) =>
    request('/recipes/active', { method: 'PUT', body: JSON.stringify({ recipeId }) }),
  applyLabToRecipe: (body) =>
    request('/recipes/apply-lab', { method: 'POST', body: JSON.stringify(body) }),
  getTraces: () => request('/traces'),
  getTrace: (id) => request(`/traces/${id}`),
  getEval: () => request('/eval'),
  addEvalItem: (body) => request('/eval/items', { method: 'POST', body: JSON.stringify(body) }),
  updateEvalItem: (id, body) => request(`/eval/items/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteEvalItem: (id) => request(`/eval/items/${id}`, { method: 'DELETE' }),
  runEval: (body) => request('/eval/run', { method: 'POST', body: JSON.stringify(body) }),
  compareEval: (body) => request('/eval/compare', { method: 'POST', body: JSON.stringify(body) }),
  getEmbeddingModels: () => request('/models/embedding'),
  getModels: () => request('/models'),
  getSettings: () => request('/settings'),
  saveSettings: (body) => request('/settings', { method: 'PUT', body: JSON.stringify(body) }),
  chat: (body, handlers = {}) =>
    new Promise((resolve, reject) => {
      fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: true }),
      })
        .then(async (response) => {
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            reject(new Error(err.error || '对话失败'));
            return;
          }
          let result = {};
          let errored = false;
          await readSseStream(response, (event, data) => {
            if (event === 'retrieval' && handlers.onRetrieval) handlers.onRetrieval(data);
            if (event === 'token' && handlers.onToken) handlers.onToken(data.text);
            if (event === 'done') result = data;
            if (event === 'error') {
              errored = true;
              reject(new Error(data.error));
            }
          });
          if (!errored) resolve(result);
        })
        .catch(reject);
    }),
};
