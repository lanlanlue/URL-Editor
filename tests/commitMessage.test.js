/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = fs.mkdtempSync(
  path.join(require('os').tmpdir(), 'url-editor-commit-')
);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const verify = (message) => {
  const file = path.join(dir, 'message');
  fs.writeFileSync(file, message);
  return spawnSync(
    process.execPath,
    [path.resolve(__dirname, '../.husky/verify-commit-msg.js'), file],
    { encoding: 'utf8' }
  ).status;
};
test.each([
  'feat: add widget',
  'fix(ui): correct URL',
  'fix: good\nbody without blank separator',
  'docs: update\n\nDetailed body (with punctuation).',
  'test(a-b): tests\r\n\r\nBody',
])('accepts %j', (message) => {
  expect(verify(message)).toBe(0);
});
test.each([
  'feat(ui: broken',
  'featui): broken',
  'feat(): empty scope',
  'fix((ui)): nested',
  'fix: ',
  'fix: \t',
  'fix(ui): \nbody',
  'unknown: title',
])('rejects malformed %j', (message) => {
  expect(verify(message)).toBe(1);
});
