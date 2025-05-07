const { readFileSync } = require('fs');
const msgPath = process.argv[2];
const msg = readFileSync(msgPath, 'utf-8').trim();

const valid = /^(feat|fix|docs|style|refactor|test|chore)\(.+\)?: .+/.test(msg);

if (!valid) {
  console.error(`
⛔️ Commit message 不符合 Conventional Commit 規範:
範例: "feat(login): 新增登入功能"
實際: "${msg}"
`);
  process.exit(1);
}
