# Handoff

State at handoff: branch `main`, all work committed locally (nothing pushed). Read `final-report.md` first, then `backlog.md`.

## Verify before any release (not done: everything so far ran in jest/jsdom with fakes)
Run these on a staging deployment in real browsers.
1. **Unreadable local record.** Corrupt or remove the local encryption key so the saved record cannot be decrypted, reload. Expect: a persistent red banner, edits are not saved, the raw record is copied to an `unreadable-backup:*` entry (IndexedDB), no check history is wiped. Switch language: the banner text changes. Sign in to a cloud account: the guest record is NOT deleted and the empty placeholder is not uploaded. Check the banner in light and dark mode.
2. **Two devices.** Device A and B signed in to the same account. Edit different entries on each, let auto-sync run on both. Expect both edits present on both devices afterwards (no silent overwrite), also with B offline for a few revisions, and with a deletion on one side and a later edit of the same entry on the other.
3. **Key rotation during a concurrent write.** Rotate the Recovery Key on A while B uploads. Expect an error on the rotating device (message may read as a decrypt failure), the remote not overwritten, the old key still working; rerunning the rotation succeeds.
4. **Two tabs, live test.** Open the app in two tabs, run "check all" in both at the same time. Expect no lost history rows, no stuck "checking" cards, closing the dialog by Escape, the close button, and backdrop click all stop the run; reopen right after closing keeps the new run.
5. **Auth edge cases.** Unauthenticated request to a sync route returns a JSON 401 (not a Worker error page); wrong/missing CSRF token returns 403; load the app with an old session older than 7 days in two tabs at once and confirm you are not logged out.

## Build and tests
```bash
npm ci
npm run lint
npm test                 # 31 suites / 642 tests at handoff, 12 consecutive green runs
npm run test:coverage    # includes src/server
```
`npm run build` was never run in this loop because it rewrites tracked files; run it on a clean checkout and record build time and bundle size if you need those numbers.

## Open items (all in `backlog.md`)
B21 remainder (backup prune/restore UI, account-scope unreadable detection), B29 orphan id (accepted), B28 clock-skew residuals, B30 real-browser check, B26 residual (needs a surrogate session id in the schema).
Needs a human decision (outside this loop's authorization): cross-isolate rate limiting, expired-session purge and storage caps (Cloudflare infrastructure), IP pinning for SSRF, CSRF rotation semantics, `npm audit` (209 findings, all dev tooling; `--omit=dev` is 0).

## Housekeeping (done)
The ten worker worktrees and their `worktree-agent-*` branches were removed after confirming every branch was merged into `main` and every worktree was clean (`git branch -d` refuses unmerged branches). `main` is the only branch. The unreferenced merge commit `c2a6d5b` (an earlier, flawed integration of Worker I that main was reset away from) is not referenced by any branch and will be garbage-collected by git eventually. `.claude/launch.json` is untracked on purpose.
