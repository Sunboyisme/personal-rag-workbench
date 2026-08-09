const { handleChatRoute } = require('./chatHandler');
const conversationService = require('./conversationService');

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getPublicConfig() {
  return {
    collectionId: process.env.PUBLIC_COLLECTION_ID || 'col_f76b4aeb',
    recipeId: process.env.PUBLIC_RECIPE_ID || 'recipe_1d35d4a0',
    corsOrigins: parseOrigins(
      process.env.PUBLIC_CORS_ORIGINS ||
        'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174,http://127.0.0.1:5175,http://localhost:5175,http://127.0.0.1:5188,http://localhost:5188'
    ),
    rateLimitPerMin: Number(process.env.PUBLIC_RATE_LIMIT_PER_MIN || 10),
    adminToken: process.env.ADMIN_TOKEN || '',
  };
}

function createRateLimiter(limitPerMin) {
  const buckets = new Map();

  function cleanup(now) {
    for (const [key, entry] of buckets.entries()) {
      if (now - entry.windowStart > 60_000) buckets.delete(key);
    }
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    cleanup(now);
    const ip =
      String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim() || req.socket.remoteAddress || 'unknown';
    let entry = buckets.get(ip);
    if (!entry || now - entry.windowStart > 60_000) {
      entry = { windowStart: now, count: 0 };
      buckets.set(ip, entry);
    }
    entry.count += 1;
    if (entry.count > limitPerMin) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    return next();
  };
}

function buildCorsOptions() {
  const { corsOrigins } = getPublicConfig();
  return {
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  };
}

function adminAuthMiddleware(req, res, next) {
  const { adminToken } = getPublicConfig();
  if (!adminToken) return next();

  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = bearer || req.headers['x-admin-token'] || '';
  if (token === adminToken) return next();

  return res.status(401).json({ error: '未授权访问' });
}

function isPublicPath(pathname) {
  return pathname.startsWith('/api/public/') || pathname === '/api/health';
}

function registerPublicRoutes(app, rateLimit) {
  const { collectionId, recipeId } = getPublicConfig();

  app.post('/api/public/conversations', rateLimit, (req, res) => {
    try {
      const conv = conversationService.createConversation({
        title: '访客对话',
        collectionId,
        recipeId,
      });
      res.json({ id: conv.id, conversationId: conv.id });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/public/chat', rateLimit, async (req, res) => {
    const question = String(req.body?.question || '').trim();
    if (!question) {
      return res.status(400).json({ error: '请输入问题' });
    }
    if (question.length > 2000) {
      return res.status(400).json({ error: '问题过长' });
    }

    req.body = {
      question,
      conversationId: req.body?.conversationId || null,
      collectionId,
      recipeId,
      stream: req.body?.stream !== false,
    };

    await handleChatRoute(req, res, { includeRetrievalEvent: false });
  });
}

module.exports = {
  getPublicConfig,
  createRateLimiter,
  buildCorsOptions,
  adminAuthMiddleware,
  isPublicPath,
  registerPublicRoutes,
};
