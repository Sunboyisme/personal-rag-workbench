const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeMultipartFilename } = require('../server/utils/encoding');

test('decodeMultipartFilename fixes latin1 mojibake', () => {
  const garbled = '00-\u00e9\u00a6\u0096\u00e9\u00a1\u00b5.md';
  assert.equal(decodeMultipartFilename(garbled), '00-首页.md');
  assert.equal(decodeMultipartFilename('AI\u00e4\u00bc\u0098\u00e5\u008c\u0096\u00e7\u00ae\u0080\u00e5\u008e\u0086.md'), 'AI优化简历.md');
});

test('decodeMultipartFilename keeps ascii and proper unicode', () => {
  assert.equal(decodeMultipartFilename('readme.md'), 'readme.md');
  assert.equal(decodeMultipartFilename('笔记/入门.md'), '笔记/入门.md');
});
