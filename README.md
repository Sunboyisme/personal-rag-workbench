# 个人 RAG 知识库 + 实验工作台

基于 Express + React 的个人 RAG 实验平台，支持 Markdown 笔记导入、切分预览、向量建库、混合检索、提示词组装、问答与评测。

## 功能

- **数据源**：上传/粘贴 Markdown，解析 frontmatter、tags、wikilink
- **切分实验室**：heading / recursive / fixed / parentChild 策略，实时预览
- **建库**：选择 ChunkSet + Embedding 模型，SSE 进度推送
- **检索实验室**：完整候选表（含落选者）、多 Collection 对比
- **提示词**：模板编辑与 token 预算预览
- **实验配置 Recipe**：fork、diff、版本管理
- **问答**：SSE 流式生成 + Trace 回放
- **评测**：Recall@K、MRR、多 Recipe 对比矩阵

## 快速启动

```powershell
cd 个人RAG知识库-260807
npm run install:all
Copy-Item .env.example .env
# 编辑 .env 填入 DEEPSEEK_API_KEY 和 SILICONFLOW_API_KEY
npm run dev
```

- Web: http://localhost:5188
- API: http://localhost:3790/api/health

生产模式：

```powershell
npm run build
npm start
# 访问 http://localhost:3790
```

## 环境变量

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | Chat 生成（DeepSeek） |
| `SILICONFLOW_API_KEY` | Embedding + Rerank（硅基流动） |
| `EMBEDDING_MODEL` | 默认 `BAAI/bge-m3` |
| `RERANK_MODEL` | 默认 `BAAI/bge-reranker-v2-m3` |
| `PORT` | API 端口，默认 3790 |

## 推荐工作流

1. **数据源** → 导入 Markdown 笔记
2. **切分实验室** → 调参预览 → 保存 ChunkSet
3. **建库** → 选择向量模型 → 生成 Collection
4. **检索实验室** → 调阈值/TopK，看完整候选排名
5. **实验配置** → fork Recipe，对比 diff
6. **评测** → 添加 20+ 评测项，跑批对比
7. **问答** → 正式使用，查看 Trace 回放
