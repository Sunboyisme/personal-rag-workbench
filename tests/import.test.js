const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isImportablePath, titleFromPath } = require('../server/pipeline/importFormats');

test('isImportablePath accepts markdown and office docs', () => {
  assert.deepEqual(isImportablePath('notes/idea.md'), { skip: false, importable: true });
  assert.deepEqual(isImportablePath('docs/guide.pdf'), { skip: false, importable: true });
  assert.deepEqual(isImportablePath('docs/guide.docx'), { skip: false, importable: true });
});

test('isImportablePath skips images and obsidian folders', () => {
  assert.equal(isImportablePath('assets/logo.png').skip, true);
  assert.equal(isImportablePath('.obsidian/config').skip, true);
  assert.equal(isImportablePath('notes/photo.jpg').reason, '附件/图片已跳过');
});

test('titleFromPath keeps folder path for disambiguation', () => {
  assert.equal(titleFromPath('AI/产品经理/入门.md'), 'AI/产品经理/入门');
  assert.equal(titleFromPath('readme.txt'), 'readme');
});
