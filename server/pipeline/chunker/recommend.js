const STRATEGY_META = {
  heading: {
    id: 'heading',
    label: '标题层级',
    summary: '按 Markdown 标题分节，超长节再递归切分',
  },
  recursive: {
    id: 'recursive',
    label: '递归切分',
    summary: '按段落/换行/句号等边界优先切开，找不到边界再固定长度兜底',
  },
  fixed: {
    id: 'fixed',
    label: '固定长度',
    summary: '按字符数滑窗切分，适合结构很弱的文本',
  },
  parentChild: {
    id: 'parentChild',
    label: '父子块',
    summary: '标题切父块 + 固定长度切子块，检索用小块、回答可带回父块',
  },
  semantic: {
    id: 'semantic',
    label: '语义切分 (LLM)',
    summary: '调用大模型按主题分组，适合结构乱但主题切换明显的长文',
  },
};

function analyzeDocument(text = '') {
  const normalized = String(text || '').replace(/\r\n/g, '\n');
  const length = normalized.length;
  const lines = normalized ? normalized.split('\n') : [];
  const headingLines = lines.filter((line) => /^#{1,6}\s+\S/.test(line));
  const headingCount = headingLines.length;
  const levels = new Set(
    headingLines
      .map((line) => (line.match(/^(#{1,6})\s+/) || [])[1]?.length)
      .filter(Boolean)
  );

  const sections = [];
  let current = { level: 0, title: '', body: [] };
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) {
      if (current.title || current.body.length) {
        sections.push({
          level: current.level,
          title: current.title,
          length: [current.title && `# ${current.title}`, ...current.body].filter(Boolean).join('\n').length,
        });
      }
      current = { level: m[1].length, title: m[2].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }
  if (current.title || current.body.length) {
    sections.push({
      level: current.level,
      title: current.title,
      length: [current.title && `# ${current.title}`, ...current.body].filter(Boolean).join('\n').length,
    });
  }

  const sectionLengths = sections.map((s) => s.length).filter((n) => n > 0);
  const avgSectionLen = sectionLengths.length
    ? Math.round(sectionLengths.reduce((a, b) => a + b, 0) / sectionLengths.length)
    : length;
  const maxSectionLen = sectionLengths.length ? Math.max(...sectionLengths) : length;
  const oversizedSections = sectionLengths.filter((n) => n > 800).length;

  const paragraphCount = normalized.split(/\n{2,}/).filter((p) => p.trim()).length;
  const sentenceCount = (normalized.match(/[。！？.!?]/g) || []).length;
  const codeFenceCount = (normalized.match(/```/g) || []).length;
  const listLineCount = lines.filter((line) => /^\s*([-*+]|\d+\.)\s+/.test(line)).length;
  const headingDensity = length > 0 ? headingCount / Math.max(1, length / 1000) : 0;
  const hasStrongHeadings = headingCount >= 3 && levels.size >= 1;
  const hasWeakStructure = headingCount <= 1 && paragraphCount <= 2;
  const looksLikeNotes = hasStrongHeadings && listLineCount + headingCount > 5;
  const longUnstructured = length >= 3000 && headingCount <= 2;
  const manyOversized = hasStrongHeadings && oversizedSections >= Math.max(2, Math.ceil(headingCount * 0.35));

  return {
    length,
    lineCount: lines.length,
    headingCount,
    headingLevels: [...levels].sort((a, b) => a - b),
    sectionCount: sections.length,
    avgSectionLen,
    maxSectionLen,
    oversizedSections,
    paragraphCount,
    sentenceCount,
    codeFenceCount: Math.floor(codeFenceCount / 2),
    listLineCount,
    headingDensity: Number(headingDensity.toFixed(2)),
    hasStrongHeadings,
    hasWeakStructure,
    looksLikeNotes,
    longUnstructured,
    manyOversized,
  };
}

function recommendChunkStrategy(text = '', options = {}) {
  const analysis = analyzeDocument(text);
  const preferredChunkSize = Number(options.chunkSize || 800);
  const reasons = [];
  const warnings = [];
  let strategy = 'recursive';
  let confidence = 'medium';

  if (!analysis.length) {
    return {
      strategy: 'heading',
      label: STRATEGY_META.heading.label,
      confidence: 'low',
      summary: '文档为空，先导入内容后再推荐。',
      reasons: ['当前文本长度为 0。'],
      warnings: [],
      alternatives: [],
      suggestedConfig: {
        strategy: 'heading',
        chunkSize: preferredChunkSize,
      },
      analysis,
    };
  }

  if (analysis.hasStrongHeadings && !analysis.manyOversized) {
    strategy = 'heading';
    confidence = analysis.looksLikeNotes ? 'high' : 'medium';
    reasons.push(`检测到 ${analysis.headingCount} 个 Markdown 标题（层级 ${analysis.headingLevels.join('/') || '-'}），结构清晰。`);
    reasons.push(`平均每节约 ${analysis.avgSectionLen} 字，多数节可直接作为一块，适合标题层级切分。`);
    if (analysis.oversizedSections > 0) {
      warnings.push(`有 ${analysis.oversizedSections} 个超长节（>${preferredChunkSize} 字），标题策略会在这些节上回退到递归切分。`);
    }
  } else if (analysis.hasStrongHeadings && analysis.manyOversized) {
    strategy = 'parentChild';
    confidence = 'high';
    reasons.push(`标题较多（${analysis.headingCount}），但有 ${analysis.oversizedSections} 个超长节（最长 ${analysis.maxSectionLen} 字）。`);
    reasons.push('父子块可以保留标题父级上下文，同时用较小子块提升检索精度。');
  } else if (analysis.longUnstructured && analysis.sentenceCount >= 8) {
    strategy = 'semantic';
    confidence = analysis.length >= 6000 ? 'high' : 'medium';
    reasons.push(`文档较长（${analysis.length} 字）且标题很少（${analysis.headingCount} 个），规则边界不一定对应主题边界。`);
    reasons.push('语义切分可用大模型按主题分组；成本更高，失败时会回退按长度打包。');
  } else if (analysis.hasWeakStructure && analysis.sentenceCount < 5) {
    strategy = 'fixed';
    confidence = 'medium';
    reasons.push('标题和段落边界都很少，几乎找不到稳定语义切点。');
    reasons.push('固定长度切分最可控，配合重叠可减少边界信息丢失。');
  } else {
    strategy = 'recursive';
    confidence = analysis.paragraphCount >= 4 || analysis.sentenceCount >= 6 ? 'high' : 'medium';
    reasons.push(`标题较弱（${analysis.headingCount} 个），但存在 ${analysis.paragraphCount} 个段落 / ${analysis.sentenceCount} 个句子边界。`);
    reasons.push('递归切分会优先在这些自然边界切开，找不到边界时再回退固定长度。');
  }

  if (analysis.codeFenceCount >= 2) {
    warnings.push(`含约 ${analysis.codeFenceCount} 个代码块，语义/固定切分可能切断代码；标题或递归通常更稳。`);
  }

  const alternatives = [];
  if (strategy !== 'heading' && analysis.headingCount >= 2) {
    alternatives.push({
      strategy: 'heading',
      label: STRATEGY_META.heading.label,
      reason: '仍有一定标题结构，可先试标题层级并调高「单节最大长度」。',
    });
  }
  if (strategy !== 'recursive') {
    alternatives.push({
      strategy: 'recursive',
      label: STRATEGY_META.recursive.label,
      reason: '不想调用模型、又希望尽量按句段边界切时，递归是稳妥默认项。',
    });
  }
  if (strategy !== 'semantic' && analysis.length >= 2500 && analysis.headingCount <= 3) {
    alternatives.push({
      strategy: 'semantic',
      label: STRATEGY_META.semantic.label,
      reason: '若预览后主题仍然被切断，可再试语义切分。',
    });
  }
  if (strategy !== 'parentChild' && analysis.hasStrongHeadings) {
    alternatives.push({
      strategy: 'parentChild',
      label: STRATEGY_META.parentChild.label,
      reason: '若检索命中碎片化、回答缺上下文，可改用父子块。',
    });
  }

  const suggestedConfig = {
    strategy,
    chunkSize: preferredChunkSize,
    overlap: strategy === 'fixed' || strategy === 'recursive' || strategy === 'parentChild' ? 50 : 50,
    minSize: Math.round(preferredChunkSize * 0.5),
    maxSize: Math.round(preferredChunkSize * 1.5),
    childSize: 300,
    parentSize: Math.max(1200, preferredChunkSize + 400),
  };

  return {
    strategy,
    label: STRATEGY_META[strategy].label,
    confidence,
    summary: STRATEGY_META[strategy].summary,
    reasons,
    warnings,
    alternatives: alternatives.slice(0, 3),
    suggestedConfig,
    analysis,
  };
}

module.exports = {
  STRATEGY_META,
  analyzeDocument,
  recommendChunkStrategy,
};
