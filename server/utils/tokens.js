function estimateTokens(text) {
  const str = String(text || '');
  const cjk = (str.match(/[\u4e00-\u9fff]/g) || []).length;
  const other = str.length - cjk;
  return Math.ceil(cjk / 1.5 + other / 4);
}

module.exports = { estimateTokens };
