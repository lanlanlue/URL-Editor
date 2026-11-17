const { readFileSync } = require('fs');
const msgPath = process.argv[2];
const msg = readFileSync(msgPath, 'utf-8');
// Validate only the header; a body may contain arbitrary text/newlines.
const header = msg.split(/\r?\n/, 1)[0];
const valid =
  /^(feat|fix|docs|style|refactor|test|chore)(\([^()\r\n]+\))?: \S[^\r\n]*$/.test(
    header
  );

if (!valid) {
  console.error(`
⛔️ Commit message 不符合 Conventional Commit 規範:
範例: "feat(login): 新增登入功能"
實際: "${msg}"
`);
  process.exit(1);
}
