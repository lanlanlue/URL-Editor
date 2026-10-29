# Final Report: autonomous engineering loop on URL-Editor

Status: **PARTIAL**. Every item taken into the loop is integrated and verified (rounds 1-5), but a few low-priority items remain open and nothing was exercised against a real browser or staging deployment.

Original HEAD: d4511c0. Final main: c4dfbc6 (docs commit follows) (after the local WIP base commit ab46b3f). All commits are local; nothing was pushed; production, D1 data, keys and permissions were not touched.

## 1. Verified results (measured on integrated main)

| Metric | Before (d4511c0 + uncommitted work) | After (9317dec) |
|---|---|---|
| Test suites | 23 | 31 |
| Tests | 184 | 642 |
| `npx jest` | pass | pass, 12 consecutive full runs green on the final tree (plain run; worktree copies no longer collected) |
| ESLint | clean | exit 0, 9 `jest/expect-expect` warnings, all in `src/server/api.test.js` |
| Coverage lines / branches, `src/js` only | 54.2% / 41.1% | not re-measured on this basis |
| Coverage lines / branches, `src/js` + `src/server` | not measured (server was not collected) | 71.2% / 60.9% |

Per-file coverage (Worker D's measured runs, lines / branches): api.js 70.4/62.0 -> 98.0/95.1 (98.17/95.12 after later fixes); secureStorage.js 71.8/50.4 -> 96.6/92.9; cryptoVault.js 63.0/41.7 -> 98.6/96.7; cloudApi.js 0/0 -> 100/100; entryCheck.js 100/50 -> 100/100; redirectGenerator.js 74.0/35.2 -> 100/98.9; trackerStripper.js 76.5/56.3 -> 100/100; settings.js 95.7/52.4 -> 100/95.2.

Diff stats were measured at round 3 (44 files, +7829/-169) and not re-measured after round 4.

Not measured: build time and bundle size (`npm run build` rewrites tracked files in the repo, so it was not run). This loop targeted correctness, so there are no performance before/after numbers.

## 2. Problems fixed (all with a failing-first test unless noted)

Data correctness and loss
- B1: startup no longer overwrites an unreadable encrypted record with empty state or wipes check history; the raw record is backed up; a persistent notice is shown; recovery requires an explicit `confirmedRecovery`.
- B2: restoring cloud data no longer re-stamps remote entries as local edits (deleted entries could resurrect).
- B12: auto-sync no longer overwrites newer remote data from another device; the server arbitrates with the last synced ETag and the existing 409 merge path runs.
- B19: an unreadable guest record's empty placeholder is never migrated or uploaded as user data; the guard clears only on saves carrying real URLs or presets.
- B5: health status is runtime-only (it was persisted and synced as an edit).
- B10: one malformed `%` sequence no longer aborts a whole batch import.

Backend correctness and security
- B23: route handlers are awaited, so 401/403 and DB errors return JSON instead of making the Worker throw (pre-existing; found by test work).
- B3 + B15: session rotation race no longer logs the user out and no longer returns an unstored CSRF token (final lookup uses immutable columns).
- B4: a failed history cleanup after a committed write is no longer reported as a sync conflict.
- B8: title extraction is linear (a 256 KB hostile body took 3900 ms before, 1 ms after); IPv6 6to4/Teredo/documentation ranges blocked; request-body errors map to fixed codes.
- B9: credentials with a missing or non-numeric `exp` are rejected; JWKS fetch has a 3 s timeout.
- B11: comma-combined CSP headers are parsed correctly in `isEmbeddable`.
- B24: bracketed IPv6 loopback accepted for OAuth config.

Round 5 (low-priority items)
- B21 (part): the unreadable-storage notice is styled by a CSS class (values identical to the former inline style, checked property by property) and re-translated on language change. Not done on purpose: pruning/restoring `unreadable-backup:*`, account-scope unreadable detection.
- B28: check records are ordered by time; the cap keeps the newest 20 by time and `previous` is the newest by time. A record whose `t` is non-numeric or more than 5 minutes in the future is treated as time-unknown and ranks oldest. The first hardening (rewriting such `t` to the merge time) was found flaky and wrong after integration (2 of 8 full runs failed because the clock ticks between recording and merging), main was reset to the last verified commit and the fix was redone.
- B30: closing the live-test dialog by any path cancels the run and clears the grid unless the dialog was reopened meanwhile.
- B29 was implemented, reviewed, found to drop valid records under clock skew and id reuse (imports restore old ids), and REVERTED; the limitation is documented in code and pinned by a test.

Round 4 (history, live test, hardening)
- B13a: check history keeps a read cache and writes additively (pending list merged into the CURRENT storage at flush), so concurrent tabs do not lose records; 500 entries x 20 records: getHistory x500 428 ms -> 1.7 ms, recordCheck x500 708 ms -> 0.4 ms (reviewer's real-timer probe). The first version of this fix lost other tabs' records and was rejected in review (FAIL), then reworked.
- B13b: stale live-test runs are cancelled by tokens and no longer record history (optional `isCurrent` on `runEntryCheck`); rapid iframe reloads keep the original source; results are re-applied after re-render; a rejected single-card check shows an offline status.
- B27: automatic sync stops after 5 consecutive 409s (about 10 PUTs instead of 124/hour) and a new edit re-arms it; new bilingual status key.
- B16: IPv6 validation rewritten to expand literals; 3fff::/20, 2001:2::/48, 2001:10::/28, 2001:20::/28 blocked (reviewer compared ~75 literals plus 300,000 random addresses against an independent predicate: 0 mismatches, no private address newly allowed, no ordinary public address newly blocked).
- B17: string `exp` rejected; cleanup failures logged; probe/delete-account body errors mapped consistently (delete-account oversize 422 -> 413; no client depends on it).
- B26: logout retries a 0-row delete after a rotation race (bounded to 3).
- B22, B25, B20: back-off never shortened; TextDecoder fallback fixed and chunk-safe; runtime health map pruned.

Reliability of checks
- B6: probe back-off now needs 3 consecutive failures (30 s); all-skipped assertions report `skipped`, not pass (UI tick and CSV fixed); a 300-URL failing run makes 3 calls instead of 300.
- B7: the keyword body read has a timeout and unused bodies are cancelled.

Tooling
- B14/B18: `jest.config.js` collects `src/server` and ignores `<rootDir>/.claude/`; about 370 tests added for previously untested modules.

## 3. Independent verification
Every behaviour-changing commit was reviewed by an independent Critic/Challenger agent that ran probes. Findings that changed the outcome:
- B1 was sent back three times (stuck read-only flag, banner not cleared, sign-in migration deleting the unreadable guest record).
- B6 was sent back once (request storm when the backend failed).
- B19 was sent back once (guard cleared by view/sort saves).
- B15's first version (keyed on the mutable `csrf_hash`) was rejected by the Orchestrator before review because it could 401 the loser of the rotation race; it was reworked and the immutable-column claim was checked by grep.
- B12: Critic found the "never-synced" fallback is reachable and untested; tests were added and mutation-checked. Three weak tests were strengthened until they fail on the base module.
Spot mutation checks on Worker D's tests (CSRF check off: 6 fail; expiry check off: 1 fails) showed the new tests are not coverage padding.

## 4. Residual risks and open backlog
- **Not verified end to end.** All sync, storage, crypto and live-test tests use mocks (fake server/D1, in-memory IndexedDB, transparent crypto codec, jsdom). Run the sign-in, restore, unreadable-record, two-device, multi-tab history and live-test flows on staging in real browsers before any release.
- B21 remainder (P3): `unreadable-backup:*` has no pruning or restore UI; unreadable detection covers the guest record only.
- B29 (P3, accepted limitation): after one tab prunes an id, another tab's still-pending records for that id are written back (orphan id until the next prune; harmless history data).
- B28 residual (P3): a tab whose clock is fast by more than 5 minutes has its OLD stored records ranked as time-unknown (oldest) until real time catches up; two tabs with identical timestamps order by flush order. Not covered: clock skew handling beyond that.
- B30 (P3): behaviour of the `close` event was emulated in jsdom and not verified in a real browser.
- B26 residual (low): a sibling session of the same user with identical created_at/last_authenticated_at/expires_at that also rotated could be adopted; for logout the action is a DELETE. Needs a surrogate session id in the schema.
- Rotation that hits a concurrent write fails with a misleading decrypt error and must be rerun (safe, poor UX). Delete-account still returns INVALID_BODY for malformed JSON while the other routes return INVALID_JSON (an existing test requires it). Filter clicks in the live-test dialog still reload the visible iframes (an existing test pins the DOM structure).
- Out of authorization, needs a human decision: cross-isolate rate limiting, expired-session purge and storage caps (Cloudflare infrastructure), IP pinning for SSRF, CSRF rotation semantics. `npm audit` reports 209 findings, all in dev/build tooling (`--omit=dev` reports 0).
- Tombstones are never pruned. The `r` field adds about 8 bytes per stored history record.

## 5. Reproduce
```bash
npm ci
npm run lint
npm test                      # plain run, 31 suites / 642 tests
npm run test:coverage         # now includes src/server
```
Run the build in a throwaway worktree (it rewrites tracked files): `npm run build`.

## 6. Production readiness (assessment only, no deployment performed)
Server-side fixes are unit tested at 98% line coverage and are low risk. Client storage, sync and history changes (B1, B2, B12, B13, B19) are the highest-value and highest-risk: unit and mock-integration tests pass, but they have not run against real browsers or staging. Recommendation: do not release before a manual staging pass of (a) sign-in with an unreadable local record, (b) two devices editing concurrently, (c) key rotation during a concurrent write, (d) two browser tabs running live tests at the same time, (e) the unreadable-storage banner appearance in light and dark mode.

## 7. Process notes and limits
- The environment has no native Sentinel/Teamwork machinery and no timer, so roles were emulated with sub-agents and git worktrees, wall-clock budget was not enforced or tracked in minutes, and progress was recorded in `progress.md` instead of every 30 minutes.
- The user paused the loop once; it was resumed on request.
- Five rounds, ten workers (A-J), each followed by independent review; four fixes were rejected or reworked after review (B1 three times, B6, B19, B15, B13/checkHistory, B12 tests, B28 twice, B29 reverted).
- Each worker's worktree started on a stale commit (d753546) and had to be reset to the intended base; this was caught from their reports and verified.
- Nothing was deleted or disabled to get a pass; changed existing assertions were reported (B3 mock for B15, auto-recovery test for B1c).
- One process failure to note: Worker I's first B28 version was merged after a single green run; the flakiness (2 of 8 runs) showed up only in the integrated tree. main was reset (local, unpushed) to the last verified commit and the fix was re-integrated after 12 consecutive green full runs. Lesson applied from then on: run the full suite repeatedly after integrating anything with timing-dependent logic.
