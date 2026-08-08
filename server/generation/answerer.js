const { getSettings } = require('../store');
const { joinApiUrl } = require('../utils/apiUrl');

async function* streamChat(messages, options = {}) {
  const settings = getSettings();
  const apiKey = options.apiKey || settings.chat.apiKey;
  const baseUrl = options.baseUrl || settings.chat.baseUrl;
  const model = options.model || settings.chat.model;

  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY');

  const response = await fetch(joinApiUrl(baseUrl, '/v1/chat/completions'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 2000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Chat API 失败: ${response.status} ${errText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore parse errors
      }
    }
  }
}

async function chat(messages, options = {}) {
  let answer = '';
  for await (const chunk of streamChat(messages, options)) {
    answer += chunk;
  }
  return answer;
}

async function chatComplete(messages, options = {}) {
  const settings = getSettings();
  const apiKey = options.apiKey || settings.chat.apiKey;
  const baseUrl = options.baseUrl || settings.chat.baseUrl;
  const model = options.model || settings.chat.model;

  if (!apiKey) throw new Error('未配置对话 API Key，无法进行语义切分');

  const response = await fetch(joinApiUrl(baseUrl, '/v1/chat/completions'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2000,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Chat API 失败: ${response.status} ${errText}`);
  }

  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('Chat API 未返回内容');
  return content;
}

function parseCitations(answer, chunks) {
  const citations = [];
  const re = /\[(\d+)\]/g;
  let match;
  while ((match = re.exec(answer)) !== null) {
    const idx = Number(match[1]) - 1;
    if (chunks[idx]) {
      citations.push({
        index: idx + 1,
        chunkId: chunks[idx].id,
        sourceId: chunks[idx].sourceId,
        headingPath: chunks[idx].headingPath,
      });
    }
  }
  return citations;
}

module.exports = { streamChat, chat, chatComplete, parseCitations };
