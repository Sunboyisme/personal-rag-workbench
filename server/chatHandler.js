const store = require('./store');
const { retrieve } = require('./retrieval/retriever');
const { buildPrompt } = require('./generation/promptBuilder');
const { streamChat, parseCitations } = require('./generation/answerer');
const recipeService = require('./recipeService');
const conversationService = require('./conversationService');

function writeSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function runChat(req, res, { writeSseFn = writeSse, includeRetrievalEvent = true } = {}) {
  const wantsSse = req.body.stream !== false;
  const { question, collectionId, recipeId, conversationId, config } = req.body;

  const recipe = recipeService.resolveRecipe(recipeId);
  if (recipeId && !recipeService.listRecipes().some((r) => r.id === recipeId)) {
    const err = new Error(`Recipe 不存在: ${recipeId}`);
    err.status = 400;
    throw err;
  }

  let conversation = null;
  if (conversationId) {
    conversation = conversationService.getConversation(conversationId);
    if (!conversation) {
      const err = new Error('会话不存在');
      err.status = 404;
      throw err;
    }
  }

  const history = conversation ? conversationService.getRecentHistory(conversation.id, 6) : [];

  const retrievalConfig = { ...(recipe?.retrieval || {}), ...(config?.retrieval || {}) };
  const result = await retrieve(question, collectionId, retrievalConfig);
  const sources = store.getSources();
  const prompt = buildPrompt(question, result.selectedChunks, sources, {
    ...(recipe?.prompt || {}),
    ...(config?.prompt || {}),
    history,
  });

  async function persistTurn(answer, citations, traceId) {
    if (!conversation) return null;
    conversationService.appendMessages(
      conversation.id,
      [
        { role: 'user', content: question },
        {
          role: 'assistant',
          content: answer,
          citations,
          traceId,
        },
      ],
      { questionForTitle: question }
    );
    return conversation.id;
  }

  if (wantsSse) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();

    if (includeRetrievalEvent) {
      writeSseFn(res, 'retrieval', {
        candidates: result.candidates,
        selectedChunks: result.selectedChunks.map((c) => ({
          id: c.id,
          text: c.text.slice(0, 200),
          headingPath: c.headingPath,
        })),
        prompt,
        timings: result.timings,
      });
    }

    let answer = '';
    for await (const chunk of streamChat(prompt.messages, {
      ...(recipe?.generation || {}),
      ...(config?.generation || {}),
    })) {
      answer += chunk;
      writeSseFn(res, 'token', { text: chunk });
    }

    const citations = parseCitations(answer, result.selectedChunks);
    const trace = recipeService.saveTrace({
      query: question,
      collectionId,
      conversationId: conversation?.id || null,
      recipeSnapshot: recipe,
      candidates: result.candidates,
      prompt,
      answer,
      citations,
      timings: result.timings,
    });
    const savedConversationId = await persistTurn(answer, citations, trace.id);
    writeSseFn(res, 'done', {
      answer,
      citations,
      traceId: trace.id,
      conversationId: savedConversationId,
    });
    res.end();
    return;
  }

  const { chat } = require('./generation/answerer');
  const answer = await chat(prompt.messages, recipe?.generation || {});
  const citations = parseCitations(answer, result.selectedChunks);
  const trace = recipeService.saveTrace({
    query: question,
    collectionId,
    conversationId: conversation?.id || null,
    recipeSnapshot: recipe,
    candidates: result.candidates,
    prompt,
    answer,
    citations,
    timings: result.timings,
  });
  const savedConversationId = await persistTurn(answer, citations, trace.id);
  res.json({
    answer,
    citations,
    trace,
    retrieval: result,
    conversationId: savedConversationId,
  });
}

async function handleChatRoute(req, res, options) {
  const wantsSse = req.body.stream !== false;
  try {
    await runChat(req, res, options);
  } catch (error) {
    const status = error.status || 400;
    if (wantsSse && !res.headersSent) {
      res.status(status).json({ error: error.message });
    } else if (wantsSse && res.headersSent) {
      writeSse(res, 'error', { error: error.message });
      res.end();
    } else {
      res.status(status).json({ error: error.message });
    }
  }
}

module.exports = { runChat, handleChatRoute, writeSse };
