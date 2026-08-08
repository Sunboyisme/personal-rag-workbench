/**
 * Normalize provider base URL so callers can safely append `/v1/...`.
 * Accepts both `https://api.example.com` and `https://api.example.com/v1`.
 */
function normalizeApiRoot(baseUrl) {
  return String(baseUrl || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
}

function joinApiUrl(baseUrl, path) {
  const root = normalizeApiRoot(baseUrl);
  const suffix = String(path || '').replace(/^\/+/, '');
  return `${root}/${suffix}`;
}

module.exports = {
  normalizeApiRoot,
  joinApiUrl,
};
