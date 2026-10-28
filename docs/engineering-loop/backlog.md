# Engineering Backlog

Base Commit: ab46b3f. All items are HYPOTHESES from read-only audits until a failing test reproduces them.

| ID | Pri | Problem | Owner | Status |
|---|---|---|---|---|
| B1 | P0 | Startup overwrites unreadable encrypted record with empty state; prune wipes history (main.js, secureStorage.js) | Worker B | INTEGRATED (fd33099) |
| B2 | P0 | restoreCloudData re-stamps remote entries as local edits; deletions resurrect (main.js) | Worker B | INTEGRATED (fd33099) |
| B3 | P0 | Session token rotation race logs user out (api.js) | Worker A | INTEGRATED (ef0705e) |
| B4 | P1 | cleanupHistory failure reported as 409 after committed write (api.js) | Worker A | INTEGRATED (ef0705e) |
| B5 | P1 | healthStatus persisted/synced as an edit; 'checking' can stick (main.js) | Worker B | INTEGRATED (fd33099) |
| B6 | P1 | Probe disabled globally 60s after one failure; skipped assertions shown as pass | Worker B | INTEGRATED (fd33099) |
| B7 | P1 | Keyword body read has no timeout (healthCheck.js) | Worker B | INTEGRATED (fd33099) |
| B8 | P1 | Title regex quadratic backtracking; IPv6 2002::/16 etc.; raw error.message as code | Worker A | INTEGRATED (ef0705e) |
| B9 | P1 | exp missing not rejected; JWKS fetch no timeout (api.js) | Worker A | INTEGRATED (ef0705e) |
| B10 | P1 | Malformed % aborts whole batch import (urlParser.js) | Worker B | INTEGRATED (fd33099) |
| B11 | P1 | isEmbeddable ignores comma-combined CSP (frameHeaders.js) | Worker A | INTEGRATED (ef0705e) |
| B12 | P2 | Auto-sync fetches fresh ETag before PUT, overwriting remote changes | Orchestrator design first | pending decision |
| B13 | P2 | checkHistory O(n^2) I/O; liveTestModal races | round 2 | pending |
| B14 | P3 | Missing tests: api.js, secureStorage, cryptoVault, cloudApi; jest.config does not collect src/server | Worker D | INTEGRATED (b248f44) |

## Out of scope (needs human decision)
Cross-isolate rate limiting, expired-session purge and storage caps (Cloudflare infra), IP pinning, npm audit (dev tooling only; --omit=dev is 0), CSRF rotation semantics.

## New from Critic/Challenger (non-blocking)
- B15 (P2): rotation race loser keeps old token_hash, so issueCsrfToken/logout UPDATE matches 0 rows and the returned CSRF token is not stored (api.js ~321-326, ~665). Fix: re-select session when changes !== 1.
- B16 (P3): IPv6 block list misses 3fff::/20, 2001:2::/48, 2001:10::/28, 2001:20::/28 (non-routable, not an SSRF vector).
- B17 (P3): `typeof claims.exp === 'number'` strictness; log cleanupHistory failures; outer readJson catch inconsistency (probe/delete give 500).
- B18 (P3): jest.config.js has no testPathIgnorePatterns for `.claude/`, so `npx jest` in the main checkout also runs worktree copies. Dev-experience only.

## New from Worker B reviews
- B19 (P1, needs decision, requires cloudSyncModal.js): when the guest record is unreadable, cloudSyncModal.js:378-392,465 starts from the empty placeholder (callbacks.getData()), sets guestMigrationPending and may upload it. Guest record is now preserved (clearGuestState guard) so no data is destroyed, but the placeholder is still migrated/uploaded. Fix: use hasUnreadableGuestRecord() to start from remote-only data, skip migration/upload, and pass { confirmedRecovery: true } only from an explicit user action.
- B20 (P3): liveTestModal.js:122,163,615 read entry.healthStatus (now always undefined); runtimeHealthStatus Map not cleaned on entry delete.
- B21 (P3): unreadable detection is guest-record only (loadAccountState throws and never sets the flag); unreadable-backup:* has no pruning or restore UI; banner not re-translated on language switch and uses inline styles.
- B22 (P3): in-flight 401/404/429 can shorten an active 30s backoff to 10s (pre-existing).

## Round 2 updates
- B19: INTEGRATED (75df3d8) after Critic rework (flag now cleared only for saves carrying real urls/presets).
- B14: INTEGRATED (b248f44). Coverage lines/branches before -> after: api.js 70.4/62.0 -> 98.0/95.1; secureStorage.js 71.8/50.4 -> 96.6/92.9; cryptoVault.js 63.0/41.7 -> 98.6/96.7; cloudApi.js 0/0 -> 100/100; entryCheck.js 100/50 -> 100/100; redirectGenerator.js 74.0/35.2 -> 100/98.9; trackerStripper.js 76.5/56.3 -> 100/100; settings.js 95.7/52.4 -> 100/95.2. Spot mutation check (CSRF check off: 6 tests fail; expiry check off: 1 fails).
- B18: RESOLVED by jest.config.js testPathIgnorePatterns ['<rootDir>/.claude/'] and src/server in collectCoverageFrom.
- B23 (P0/P1, found by Worker D): api.js route dispatch lacks `await` for logout/sync GET/PUT/revisions/delete-account, so thrown 401/403 Responses and DB errors make handleApiRequest reject (Worker throws) instead of returning JSON. Pre-existing. Assigned to Worker E with B24 (`[::1]` hostname) and B15.
- B25 (P3): cryptoVault.js:13-16 TextDecoder fallback spreads an ArrayBuffer (breaks only where TextDecoder is missing, e.g. jsdom).
