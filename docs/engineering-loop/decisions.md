# Decisions

1. Base Commit: user chose to commit WIP as ab46b3f (local only).
2. Explicit user approval to start execution was given after the backlog was presented.
3. No Production, D1, push, key/permission changes. Infra-level findings are recorded, not implemented.
4. Environment has no native Sentinel/Teamwork; roles are emulated with Agent + git worktrees.
5. `npm run build` is not run in the main checkout because it rewrites tracked files; build baseline to be taken in a worktree.
6. Worker A integrated by fast-forward (main was still at ab46b3f), so no merge conflicts and full commit traceability.
7. Running bare `npx jest` in main also collects .claude/worktrees copies; use --testPathIgnorePatterns '/.claude/' for authoritative main results (B18).
