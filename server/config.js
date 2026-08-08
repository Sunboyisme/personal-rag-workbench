const path = require('path');
const dotenv = require('dotenv');

const rootDir = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

module.exports = {
  rootDir,
  dataDir: process.env.APP_DATA_DIR
    ? path.resolve(process.env.APP_DATA_DIR)
    : path.join(rootDir, 'data'),
  port: Number(process.env.PORT || 3790),
  chat: {
    apiKey:
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.LLM_API_KEY ||
      '',
    baseUrl:
      process.env.DEEPSEEK_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      process.env.LLM_BASE_URL ||
      'https://api.deepseek.com',
    model:
      process.env.DEEPSEEK_MODEL ||
      process.env.LLM_MODEL ||
      process.env.OPENAI_MODEL ||
      'deepseek-chat',
  },
  embedding: {
    apiKey: process.env.SILICONFLOW_API_KEY || process.env.EMBEDDING_API_KEY || '',
    baseUrl: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn',
    model: process.env.EMBEDDING_MODEL || 'BAAI/bge-m3',
    dimensions: process.env.EMBEDDING_DIMENSIONS
      ? Number(process.env.EMBEDDING_DIMENSIONS)
      : null,
  },
  rerank: {
    apiKey: process.env.SILICONFLOW_API_KEY || process.env.RERANK_API_KEY || '',
    baseUrl: process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn',
    model: process.env.RERANK_MODEL || 'BAAI/bge-reranker-v2-m3',
  },
};
