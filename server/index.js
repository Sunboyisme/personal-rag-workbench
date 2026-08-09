const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { port, dataDir } = require('./config');
const store = require('./store');
const { loadMarkdownContent, loadSourceFile } = require('./pipeline/loader');
const { isImportablePath, titleFromPath } = require('./pipeline/importFormats');
const { decodeMultipartFilename } = require('./utils/encoding');
const { chunkTextAsync, computeStats } = require('./pipeline/chunker');
const { recommendChunkStrategy } = require('./pipeline/chunker/recommend');
const { buildCollection } = require('./pipeline/indexer');
const { retrieve } = require('./retrieval/retriever');
const { buildPrompt } = require('./generation/promptBuilder');
const recipeService = require('./recipeService');
const promptService = require('./promptService');
const conversationService = require('./conversationService');
const { handleChatRoute, writeSse } = require('./chatHandler');
const {
  getPublicConfig,
  createRateLimiter,
  buildCorsOptions,
  adminAuthMiddleware,
  isPublicPath,
  registerPublicRoutes,
} = require('./publicGateway');

const publicConfig = getPublicConfig();
const publicRateLimit = createRateLimiter(publicConfig.rateLimitPerMin);

const app = express();
app.use(cors(buildCorsOptions()));
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
  if (isPublicPath(req.path)) return next();
  return adminAuthMiddleware(req, res, next);
});

registerPublicRoutes(app, publicRateLimit);

const upload = multer({ dest: path.join(dataDir, 'uploads') });

// Health & settings
app.get('/api/health', (_req, res) => {
  const settings = store.getPublicSettings();
  const ready =
    settings.chat.apiKeySet && settings.embedding.apiKeySet && settings.rerank.apiKeySet;
  res.json({
    ok: true,
    ready,
    service: 'personal-rag-workbench',
    port,
    apiKeys: {
      chat: settings.chat.apiKeySet,
      embedding: settings.embedding.apiKeySet,
      rerank: settings.rerank.apiKeySet,
    },
  });
});

app.get('/api/settings', (_req, res) => {
  res.json(store.getPublicSettings());
});

app.put('/api/settings', (req, res) => {
  res.json(store.saveSettings(req.body));
});

// Sources
app.get('/api/sources', (_req, res) => {
  res.json(store.getSources());
});

app.get('/api/sources/:id', (req, res) => {
  const source = store.getSource(req.params.id);
  if (!source) return res.status(404).json({ error: 'Source 不存在' });
  const contentPath = path.join(dataDir, 'sources', `${source.id}.md`);
  const content = fs.existsSync(contentPath) ? fs.readFileSync(contentPath, 'utf8') : '';
  res.json({ ...source, content });
});

app.post('/api/sources/upload', upload.array('files', 200), async (req, res) => {
  try {
    const sources = store.getSources();
    const created = [];
    const skipped = [];
    const failed = [];

    for (const file of req.files || []) {
      const filename = decodeMultipartFilename(String(file.originalname || file.filename || ''));
      const check = isImportablePath(filename);
      if (check.skip) {
        skipped.push({ name: filename, reason: check.reason });
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        continue;
      }

      try {
        const parsed = await loadSourceFile(file.path, filename, { relativePath: filename });
        if (!parsed.content?.trim()) {
          skipped.push({ name: filename, reason: '内容为空' });
          continue;
        }

        const id = `src_${uuidv4().slice(0, 8)}`;
        const record = {
          id,
          title: parsed.title,
          filename,
          sourceFormat: parsed.sourceFormat || 'md',
          tags: parsed.tags,
          aliases: parsed.aliases,
          links: parsed.links,
          frontmatter: parsed.frontmatter,
          charCount: parsed.content.length,
          createdAt: new Date().toISOString(),
        };
        fs.mkdirSync(path.join(dataDir, 'sources'), { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'sources', `${id}.md`), parsed.content, 'utf8');
        sources.push(record);
        created.push(record);
      } catch (error) {
        failed.push({ name: filename, error: error.message });
      } finally {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      }
    }

    store.saveSources(sources);
    res.json({ created, skipped, failed });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/sources/paste', (req, res) => {
  try {
    const { title, content } = req.body;
    const parsed = loadMarkdownContent(content, { title: title || '粘贴文档' });
    const id = `src_${uuidv4().slice(0, 8)}`;
    const record = {
      id,
      title: parsed.title,
      filename: `${parsed.title}.md`,
      tags: parsed.tags,
      aliases: parsed.aliases,
      links: parsed.links,
      frontmatter: parsed.frontmatter,
      charCount: parsed.content.length,
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(path.join(dataDir, 'sources'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'sources', `${id}.md`), parsed.content, 'utf8');
    const sources = store.getSources();
    sources.push(record);
    store.saveSources(sources);
    res.json(record);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/sources/:id', (req, res) => {
  const sources = store.getSources().filter((s) => s.id !== req.params.id);
  store.saveSources(sources);
  const contentPath = path.join(dataDir, 'sources', `${req.params.id}.md`);
  if (fs.existsSync(contentPath)) fs.unlinkSync(contentPath);
  res.json({ ok: true });
});

app.put('/api/sources/:id', (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: '标题不能为空' });
    const sources = store.getSources();
    const idx = sources.findIndex((s) => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Source 不存在' });
    sources[idx] = { ...sources[idx], title };
    store.saveSources(sources);
    res.json(sources[idx]);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/sources/repair-titles', (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
    const sources = store.getSources();
    const targets = ids ? sources.filter((s) => ids.includes(s.id)) : sources;
    let fixed = 0;
    for (const source of targets) {
      if (repairSourceRecord(source)) fixed += 1;
    }
    store.saveSources(sources);
    res.json({ fixed, total: targets.length });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function repairSourceRecord(source) {
  const contentPath = path.join(dataDir, 'sources', `${source.id}.md`);
  if (!fs.existsSync(contentPath)) return false;
  const raw = fs.readFileSync(contentPath, 'utf8');
  const decodedFilename = decodeMultipartFilename(source.filename || '');
  const pathTitle = decodedFilename.includes('/')
    ? titleFromPath(decodedFilename)
    : path.basename(decodedFilename, path.extname(decodedFilename));
  const parsed = loadMarkdownContent(raw, { filename: decodedFilename, title: pathTitle });
  const nextTitle = parsed.title;
  const nextFilename = decodedFilename || source.filename;
  if (nextTitle !== source.title || nextFilename !== source.filename) {
    source.title = nextTitle;
    source.filename = nextFilename;
    return true;
  }
  return false;
}

app.post('/api/sources/batch', (req, res) => {
  try {
    const { action, ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: '请至少选择一篇文档' });
    }
    const idSet = new Set(ids);

    if (action === 'delete') {
      for (const id of ids) {
        const contentPath = path.join(dataDir, 'sources', `${id}.md`);
        if (fs.existsSync(contentPath)) fs.unlinkSync(contentPath);
      }
      const remaining = store.getSources().filter((s) => !idSet.has(s.id));
      store.saveSources(remaining);
      return res.json({ action, affected: ids.length });
    }

    if (action === 'repairTitles') {
      const sources = store.getSources();
      let fixed = 0;
      for (const source of sources) {
        if (!idSet.has(source.id)) continue;
        if (repairSourceRecord(source)) fixed += 1;
      }
      store.saveSources(sources);
      return res.json({ action, fixed, total: ids.length });
    }

    return res.status(400).json({ error: `未知批量操作: ${action}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Chunk preview & chunksets
app.post('/api/chunk/preview', async (req, res) => {
  try {
    const { text, sourceId, config } = req.body;
    const chunks = await chunkTextAsync(text || '', sourceId || 'preview', config || {});
    res.json({ chunks, stats: computeStats(chunks) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/chunk/recommend', (req, res) => {
  try {
    const { text, chunkSize } = req.body || {};
    const result = recommendChunkStrategy(text || '', { chunkSize });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/chunk/preview/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  try {
    const { text, sourceId, config } = req.body;
    const chunks = await chunkTextAsync(
      text || '',
      sourceId || 'preview',
      config || {},
      (event, data) => writeSse(res, event, data)
    );
    writeSse(res, 'done', { chunks, stats: computeStats(chunks) });
    res.end();
  } catch (error) {
    writeSse(res, 'error', { error: error.message });
    res.end();
  }
});

app.get('/api/chunksets', (_req, res) => {
  res.json(store.listSubJson('chunksets'));
});

app.get('/api/chunksets/:id', (req, res) => {
  const cs = store.readSubJson('chunksets', req.params.id);
  if (!cs) return res.status(404).json({ error: 'ChunkSet 不存在' });
  res.json(cs);
});

app.put('/api/chunksets/:id', (req, res) => {
  const id = req.params.id;
  const cs = store.readSubJson('chunksets', id);
  if (!cs) return res.status(404).json({ error: 'ChunkSet 不存在' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '名称不能为空' });

  const updated = {
    ...cs,
    name,
    updatedAt: new Date().toISOString(),
  };
  store.writeSubJson('chunksets', id, updated);
  res.json(updated);
});

app.delete('/api/chunksets/:id', (req, res) => {
  const id = req.params.id;
  const cs = store.readSubJson('chunksets', id);
  if (!cs) return res.status(404).json({ error: 'ChunkSet 不存在' });

  const linked = store.getCollections().filter((c) => c.chunkSetId === id);
  const force = String(req.query.force || '') === '1' || req.body?.force === true;
  if (linked.length && !force) {
    return res.status(409).json({
      error: `有 ${linked.length} 个 Collection 引用此 ChunkSet，确认后可强制删除`,
      linked: linked.map((c) => ({ id: c.id, name: c.name })),
    });
  }

  store.deleteSubJson('chunksets', id);
  res.json({
    ok: true,
    deleted: id,
    name: cs.name,
    linkedCollections: linked.map((c) => ({ id: c.id, name: c.name })),
  });
});

app.post('/api/chunksets', async (req, res) => {
  try {
    const { name, sourceIds, config } = req.body;
    const allChunks = [];
    for (const sourceId of sourceIds || []) {
      const source = store.getSource(sourceId);
      if (!source) continue;
      const contentPath = path.join(dataDir, 'sources', `${sourceId}.md`);
      const text = fs.existsSync(contentPath) ? fs.readFileSync(contentPath, 'utf8') : '';
      const chunks = await chunkTextAsync(text, sourceId, {
        ...(config || {}),
        meta: { tags: source.tags, title: source.title },
      });
      allChunks.push(...chunks);
    }
    const id = `cs_${uuidv4().slice(0, 8)}`;
    const chunkSet = {
      id,
      name: name || `ChunkSet ${new Date().toLocaleString('zh-CN')}`,
      sourceIds: sourceIds || [],
      chunkingConfig: config || {},
      stats: computeStats(allChunks),
      chunks: allChunks,
      createdAt: new Date().toISOString(),
    };
    store.writeSubJson('chunksets', id, chunkSet);
    res.json(chunkSet);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

function buildConfigForStrategy(strategy, base = {}) {
  const chunkSize = Number(base.chunkSize || 800);
  return {
    strategy,
    chunkSize,
    overlap: Number(base.overlap || 50),
    minSize: Number(base.minSize || Math.round(chunkSize * 0.5)),
    maxSize: Number(base.maxSize || Math.round(chunkSize * 1.5)),
    childSize: Number(base.childSize || 300),
    parentSize: Number(base.parentSize || Math.max(1200, chunkSize + 400)),
    semanticModel: base.semanticModel,
  };
}

app.post('/api/chunksets/auto-by-recommend', async (req, res) => {
  try {
    const {
      sourceIds,
      chunkSize = 800,
      namePrefix,
      downgradeSemantic = true,
      semanticModel,
    } = req.body || {};
    const allSources = store.getSources();
    const targets = (sourceIds?.length
      ? allSources.filter((s) => sourceIds.includes(s.id))
      : allSources);
    if (!targets.length) {
      return res.status(400).json({ error: '没有可处理的文档' });
    }

    const groupsMap = new Map();
    const assignments = [];

    for (const source of targets) {
      const contentPath = path.join(dataDir, 'sources', `${source.id}.md`);
      const text = fs.existsSync(contentPath) ? fs.readFileSync(contentPath, 'utf8') : '';
      const rec = recommendChunkStrategy(text, { chunkSize });
      let appliedStrategy = rec.strategy;
      let note = null;
      if (appliedStrategy === 'semantic' && downgradeSemantic) {
        appliedStrategy = 'recursive';
        note = '批量场景下语义切分成本高，已降级为递归切分';
      }
      if (!groupsMap.has(appliedStrategy)) {
        groupsMap.set(appliedStrategy, []);
      }
      groupsMap.get(appliedStrategy).push(source.id);
      assignments.push({
        sourceId: source.id,
        title: source.title,
        recommended: rec.strategy,
        applied: appliedStrategy,
        confidence: rec.confidence,
        note,
        reasons: rec.reasons,
      });
    }

    const stamp = new Date().toLocaleString('zh-CN');
    const prefix = namePrefix || `批量 ${stamp}`;
    const created = [];

    for (const [strategy, ids] of groupsMap.entries()) {
      const config = buildConfigForStrategy(strategy, { chunkSize, semanticModel });
      const allChunks = [];
      for (const sourceId of ids) {
        const source = store.getSource(sourceId);
        if (!source) continue;
        const contentPath = path.join(dataDir, 'sources', `${sourceId}.md`);
        const text = fs.existsSync(contentPath) ? fs.readFileSync(contentPath, 'utf8') : '';
        const chunks = await chunkTextAsync(text, sourceId, {
          ...config,
          meta: { tags: source.tags, title: source.title },
        });
        allChunks.push(...chunks);
      }
      const id = `cs_${uuidv4().slice(0, 8)}`;
      const label = {
        heading: '标题层级',
        recursive: '递归切分',
        fixed: '固定长度',
        parentChild: '父子块',
        semantic: '语义切分',
      }[strategy] || strategy;
      const chunkSet = {
        id,
        name: `${prefix} · ${label}`,
        sourceIds: ids,
        chunkingConfig: config,
        stats: computeStats(allChunks),
        chunks: allChunks,
        createdAt: new Date().toISOString(),
        meta: {
          autoGrouped: true,
          strategy,
          sourceCount: ids.length,
        },
      };
      store.writeSubJson('chunksets', id, chunkSet);
      created.push({
        id: chunkSet.id,
        name: chunkSet.name,
        strategy,
        sourceCount: ids.length,
        chunkCount: chunkSet.stats.count,
      });
    }

    res.json({
      totalSources: targets.length,
      groupCount: created.length,
      downgradeSemantic: Boolean(downgradeSemantic),
      assignments,
      created,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Collections / indexing
app.get('/api/collections', (_req, res) => {
  res.json(store.getCollections());
});

app.put('/api/collections/:id', (req, res) => {
  const id = req.params.id;
  const collections = store.getCollections();
  const idx = collections.findIndex((c) => c.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Collection 不存在' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '名称不能为空' });

  collections[idx] = {
    ...collections[idx],
    name,
    updatedAt: new Date().toISOString(),
  };
  store.saveCollections(collections);
  res.json(collections[idx]);
});

app.delete('/api/collections/:id', (req, res) => {
  const id = req.params.id;
  const collections = store.getCollections();
  const target = collections.find((c) => c.id === id);
  if (!target) return res.status(404).json({ error: 'Collection 不存在' });

  const next = collections.filter((c) => c.id !== id);
  store.saveCollections(next);

  // 清理向量与 BM25 文件
  if (target.vectorSetId) {
    for (const suffix of ['.bin', '.meta.json', '.bm25.json']) {
      const file = path.join(dataDir, 'vectors', `${target.vectorSetId}${suffix}`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }

  res.json({ ok: true, deleted: id, name: target.name });
});

app.post('/api/collections/build', async (req, res) => {
  const wantsSse = req.headers.accept === 'text/event-stream';
  if (wantsSse) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
    try {
      const collection = await buildCollection(req.body, (progress) =>
        writeSse(res, 'progress', progress)
      );
      writeSse(res, 'done', collection);
      res.end();
    } catch (error) {
      writeSse(res, 'error', { error: error.message });
      res.end();
    }
    return;
  }
  try {
    const collection = await buildCollection(req.body);
    res.json(collection);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Retrieval
app.post('/api/retrieval/preview', async (req, res) => {
  try {
    const { query, collectionId, config } = req.body;
    const result = await retrieve(query, collectionId, config || {});
    const sources = store.getSources();
    const prompt = buildPrompt(query, result.selectedChunks, sources, config?.prompt || {});
    res.json({ ...result, prompt });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/retrieval/compare', async (req, res) => {
  try {
    const { query, collectionIds, config } = req.body;
    const results = [];
    let sharedRewrite = null;
    for (const collectionId of collectionIds || []) {
      const nextConfig = { ...(config || {}) };
      // 多库对比时只改写一次 query，避免重复调用模型
      if (sharedRewrite && nextConfig.queryRewrite && nextConfig.queryRewrite !== 'off') {
        nextConfig._prewrittenQuery = sharedRewrite;
      }
      const result = await retrieve(query, collectionId, nextConfig);
      if (!sharedRewrite && result.queryRewrite) sharedRewrite = result.queryRewrite;
      const sources = store.getSources();
      const prompt = buildPrompt(query, result.selectedChunks, sources, config?.prompt || {});
      results.push({ collectionId, ...result, prompt });
    }
    res.json({ query, results });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Prompts (versioned)
app.get('/api/prompts', (_req, res) => {
  res.json(promptService.listPromptVersions());
});

app.get('/api/prompts/active', (_req, res) => {
  const version = promptService.resolvePromptVersion();
  res.json({
    activePromptId: version?.id || null,
    version,
    templates: promptService.getActiveTemplates(),
  });
});

app.put('/api/prompts/active', (req, res) => {
  try {
    res.json(promptService.setActivePrompt(req.body?.promptId));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/prompts/diff', (req, res) => {
  try {
    res.json(promptService.diffPromptVersions(req.query.a, req.query.b));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/prompts', (req, res) => {
  res.json(promptService.createPromptVersion(req.body || {}));
});

// 兼容旧接口：写入当前激活版本
app.put('/api/prompts', (req, res) => {
  res.json(store.savePromptTemplates(req.body || {}));
});

app.post('/api/prompts/preview', (req, res) => {
  const { question, chunks, sources } = req.body;
  const prompt = buildPrompt(question, chunks || [], sources || store.getSources(), req.body);
  res.json(prompt);
});

app.post('/api/prompts/:id/fork', (req, res) => {
  try {
    res.json(promptService.forkPromptVersion(req.params.id, req.body?.name));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/prompts/:id', (req, res) => {
  const updated = promptService.updatePromptVersion(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: '提示词版本不存在' });
  res.json(updated);
});

app.delete('/api/prompts/:id', (req, res) => {
  try {
    res.json(promptService.deletePromptVersion(req.params.id));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Recipes
app.get('/api/recipes', (_req, res) => {
  res.json(recipeService.listRecipes());
});

app.get('/api/recipes/active', (_req, res) => {
  const recipe = recipeService.resolveRecipe();
  res.json({
    activeRecipeId: recipe?.id || null,
    recipe,
  });
});

app.put('/api/recipes/active', (req, res) => {
  try {
    const recipeId = req.body?.recipeId;
    const recipes = recipeService.listRecipes();
    if (!recipes.some((r) => r.id === recipeId)) {
      return res.status(400).json({ error: `Recipe 不存在: ${recipeId}` });
    }
    store.saveSettings({ activeRecipeId: recipeId });
    res.json({
      activeRecipeId: recipeId,
      recipe: recipes.find((r) => r.id === recipeId),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/recipes/diff', (req, res) => {
  try {
    res.json(recipeService.diffRecipes(req.query.a, req.query.b));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/recipes', (req, res) => {
  res.json(recipeService.createRecipe(req.body));
});

app.post('/api/recipes/apply-lab', (req, res) => {
  try {
    res.json(recipeService.applyLabRetrieval(req.body || {}));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/recipes/:id/fork', (req, res) => {
  try {
    res.json(recipeService.forkRecipe(req.params.id, req.body.name));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/recipes/:id', (req, res) => {
  const updated = recipeService.updateRecipe(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: 'Recipe 不存在' });
  res.json(updated);
});

app.delete('/api/recipes/:id', (req, res) => {
  try {
    res.json(recipeService.deleteRecipe(req.params.id));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Chat / QA
app.post('/api/chat', (req, res) => handleChatRoute(req, res));

// Conversations
app.get('/api/conversations', (_req, res) => {
  res.json(conversationService.listConversations());
});

app.post('/api/conversations', (req, res) => {
  try {
    const conv = conversationService.createConversation(req.body || {});
    res.json(conv);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/conversations/:id', (req, res) => {
  const conv = conversationService.getConversation(req.params.id);
  if (!conv) return res.status(404).json({ error: '会话不存在' });
  res.json(conv);
});

app.patch('/api/conversations/:id', (req, res) => {
  const updated = conversationService.updateConversation(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ error: '会话不存在' });
  res.json(updated);
});

app.delete('/api/conversations/:id', (req, res) => {
  const ok = conversationService.deleteConversation(req.params.id);
  if (!ok) return res.status(404).json({ error: '会话不存在' });
  res.json({ ok: true });
});

// Traces
app.get('/api/traces', (_req, res) => {
  res.json(recipeService.listTraces());
});

app.get('/api/traces/:id', (req, res) => {
  const trace = recipeService.getTrace(req.params.id);
  if (!trace) return res.status(404).json({ error: 'Trace 不存在' });
  res.json(trace);
});

// Eval
app.get('/api/eval', (_req, res) => {
  evalService.ensureSeedEvalItems();
  res.json(store.getEvalSet());
});

app.get('/api/eval/criteria', (_req, res) => {
  res.json(evalService.listCriteria());
});

app.post('/api/eval/seed', (_req, res) => {
  const data = store.getEvalSet();
  if ((data.items || []).length > 0) {
    return res.json({ seeded: false, message: '评估集已有题目，未覆盖', data });
  }
  res.json({ seeded: true, data: evalService.ensureSeedEvalItems() });
});

app.get('/api/eval/runs/:id', (req, res) => {
  const run = evalService.getEvalRun(req.params.id);
  if (!run) return res.status(404).json({ error: '评测报告不存在' });
  res.json(run);
});

app.get('/api/eval/compares/:id', (req, res) => {
  const compare = evalService.getEvalCompare(req.params.id);
  if (!compare) return res.status(404).json({ error: '对比报告不存在' });
  res.json(compare);
});

app.post('/api/eval/items', (req, res) => {
  try {
    if (!req.body?.question?.trim()) return res.status(400).json({ error: '问题不能为空' });
    res.json(evalService.addEvalItem(req.body));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/eval/items/:id', (req, res) => {
  const updated = evalService.updateEvalItem(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: '评测项不存在' });
  res.json(updated);
});

app.delete('/api/eval/items/:id', (req, res) => {
  evalService.deleteEvalItem(req.params.id);
  res.json({ ok: true });
});

app.post('/api/eval/run', async (req, res) => {
  try {
    const recipe = req.body.recipeId
      ? recipeService.listRecipes().find((r) => r.id === req.body.recipeId)
      : recipeService.resolveRecipe();
    if (!recipe) return res.status(400).json({ error: 'Recipe 不存在' });
    const run = await evalService.runEvalBatch({ ...req.body, recipe });
    res.json(run);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/eval/compare', async (req, res) => {
  try {
    const compare = await evalService.runEvalCompare(req.body || {});
    res.json(compare);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Model catalogs (built-in + user-added)
const { mergeCatalog } = require('./modelCatalog');

app.get('/api/models', (_req, res) => {
  res.json(mergeCatalog(store.getCustomModelCatalog()));
});

app.get('/api/models/embedding', (_req, res) => {
  const models = mergeCatalog(store.getCustomModelCatalog()).embedding;
  res.json(
    models.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      context: m.context || 8192,
      dim: m.dim || null,
      dimensionsOptions: m.dimensionsOptions,
      custom: Boolean(m.custom),
    }))
  );
});

// Static + SPA
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^(?!\/api).*/, (_req, res) => {
  const indexHtml = path.join(clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) res.sendFile(indexHtml);
  else res.status(404).send('请先运行 npm run build 构建前端');
});

store.ensureDataDir();
recipeService.ensureDefaultRecipe();
promptService.ensurePromptVersions();

const publicSettings = store.getPublicSettings();
const missingKeys = [];
if (!publicSettings.chat.apiKeySet) missingKeys.push('DEEPSEEK_API_KEY');
if (!publicSettings.embedding.apiKeySet) missingKeys.push('SILICONFLOW_API_KEY (embedding)');
if (!publicSettings.rerank.apiKeySet) missingKeys.push('SILICONFLOW_API_KEY (rerank)');

app.listen(port, () => {
  console.log(`RAG Workbench API running at http://localhost:${port}`);
  if (missingKeys.length) {
    console.warn(
      `[警告] 未检测到 API Key：${missingKeys.join('、')}。` +
        ' 请在项目根目录 .env 中配置后重启服务，否则建库/检索/对话将无法使用。'
    );
  }
});
