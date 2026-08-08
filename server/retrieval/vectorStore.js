function normalize(vec) {
  let norm = 0;
  for (let i = 0; i < vec.length; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Float32Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) out[i] = vec[i] / norm;
  return out;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot;
}

function searchVectors(queryVector, storedVectors, topK = 20) {
  const q = normalize(queryVector);
  const results = storedVectors.map((vec, idx) => ({
    index: idx,
    score: cosineSimilarity(q, normalize(vec)),
  }));
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

module.exports = { normalize, cosineSimilarity, searchVectors };
