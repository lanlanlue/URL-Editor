/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const workflow = (name) =>
  fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8');

test('direct PR checks explicitly use read-only repository contents permission', () => {
  const ci = workflow('ci.yml');
  expect(ci).toMatch(/\n {2}pull_request:\n {4}branches: \['main'\]/);
  expect(ci).toMatch(/\npermissions:\n {2}contents: read\n/);
  expect(ci).not.toMatch(/write-all|contents: write|pull_request_target/);
});

test('deployment depends on reusable checks and never runs on PRs', () => {
  const main = workflow('main.yml');
  expect(main).toMatch(/checks:\s*\n\s*uses: \.\/\.github\/workflows\/ci.yml/);
  expect(main).toMatch(/needs: checks/);
  expect(main).toContain("github.event_name != 'pull_request'");
  expect(main).toContain("node-version: '20'");
  expect(main).toContain('run: npm ci');
  expect(main).not.toContain('run: npm install');
  expect(workflow('ci.yml')).toContain('workflow_call:');
});
