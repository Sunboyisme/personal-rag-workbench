const crypto = require('crypto');

function stableHash(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').slice(0, 16);
}

function chunkId(sourceId, charStart, text) {
  return stableHash(`${sourceId}:${charStart}:${text}`);
}

module.exports = { stableHash, chunkId };
