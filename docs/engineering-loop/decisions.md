# Decisions

1. Base Commit: user chose to commit WIP as ab46b3f (local only).
2. Explicit user approval to start execution was given after the backlog was presented.
3. No Production, D1, push, key/permission changes. Infra-level findings are recorded, not implemented.
4. Environment has no native Sentinel/Teamwork; roles are emulated with Agent + git worktrees.
5. `npm run build` is not run in the main checkout because it rewrites tracked files; build baseline to be taken in a worktree.
6. Worker A integrated by fast-forward (main was still at ab46b3f), so no merge conflicts and full commit traceability.
7. Running bare `npx jest` in main also collects .claude/worktrees copies; use --testPathIgnorePatterns '/.claude/' for authoritative main results (B18).
8. B1 went through three reworks; the third used an explicit design (recovery only with confirmedRecovery:true, banner derived from storage state) after two ad-hoc strategies each exposed a new hole.
9. B19 (cloudSyncModal placeholder migration) is outside Worker B's ownership and left for a human decision because the guest record is already preserved.
10. B12 (auto-sync ETag overwrite) remains a design item for the user; not implemented.
11. Worker C's first B19 version was sent back after review showed the placeholder guard could be cleared by non-data saves (view/sort), because uploadCurrentData's fresh-ETag fetch (B12) would then let an empty payload overwrite remote data.
12. B29 reverted: a wall-clock prune marker drops valid records under skew and id reuse; the harmless orphan id it targets is accepted instead.
13. Local reset of main from c2a6d5b to d13637d (unpushed merge commit) after a flaky test appeared post-integration; the worker branch kept the commits and was re-merged after the fix.
