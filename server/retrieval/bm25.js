function tokenize(text) {
  const str = String(text || '').toLowerCase();
  const tokens = [];
  const cjk = str.match(/[\u4e00-\u9fff]+/g) || [];
  for (const seg of cjk) {
    for (let i = 0; i < seg.length; i += 1) {
      tokens.push(seg[i]);
      if (i < seg.length - 1) tokens.push(seg.slice(i, i + 2));
    }
  }
  const words = str.match(/[a-z0-9_]+/g) || [];
  tokens.push(...words);
  return tokens;
}

class BM25Index {
  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.docs = [];
    this.docLengths = [];
    this.avgDocLength = 0;
    this.df = {};
    this.N = 0;
  }

  build(chunks) {
    this.docs = chunks.map((c) => ({
      chunkId: c.id,
      tokens: tokenize(c.text),
      text: c.text,
    }));
    this.N = this.docs.length;
    this.docLengths = this.docs.map((d) => d.tokens.length);
    this.avgDocLength =
      this.docLengths.reduce((a, b) => a + b, 0) / Math.max(1, this.N);
    this.df = {};
    for (const doc of this.docs) {
      const seen = new Set(doc.tokens);
      for (const term of seen) {
        this.df[term] = (this.df[term] || 0) + 1;
      }
    }
    return this;
  }

  score(query) {
    const qTokens = tokenize(query);
    const scores = this.docs.map((doc, idx) => {
      let score = 0;
      const dl = this.docLengths[idx];
      for (const term of qTokens) {
        const df = this.df[term] || 0;
        if (!df) continue;
        const tf = doc.tokens.filter((t) => t === term).length;
        const idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
        const denom = tf + this.k1 * (1 - this.b + (this.b * dl) / this.avgDocLength);
        score += idf * ((tf * (this.k1 + 1)) / denom);
      }
      return { chunkId: doc.chunkId, score, text: doc.text };
    });
    return scores.sort((a, b) => b.score - a.score);
  }

  serialize() {
    return {
      k1: this.k1,
      b: this.b,
      docs: this.docs,
      docLengths: this.docLengths,
      avgDocLength: this.avgDocLength,
      df: this.df,
      N: this.N,
    };
  }

  static deserialize(data) {
    const idx = new BM25Index(data.k1, data.b);
    Object.assign(idx, data);
    return idx;
  }
}

module.exports = { BM25Index, tokenize };
