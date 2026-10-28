# Engineering Backlog

Base Commit: ab46b3f. All items are HYPOTHESES from read-only audits until a failing test reproduces them.

| ID | Pri | Problem | Owner | Status |
|---|---|---|---|---|
| B1 | P0 | Startup overwrites unreadable encrypted record with empty state; prune wipes history (main.js, secureStorage.js) | Worker B | in progress |
| B2 | P0 | restoreCloudData re-stamps remote entries as local edits; deletions resurrect (main.js) | Worker B | in progress |
| B3 | P0 | Session token rotation race logs user out (api.js) | Worker A | INTEGRATED (ef0705e) |
| B4 | P1 | cleanupHistory failure reported as 409 after committed write (api.js) | Worker A | INTEGRATED (ef0705e) |
| B5 | P1 | healthStatus persisted/synced as an edit; 'checking' can stick (main.js) | Worker B | in progress |
| B6 | P1 | Probe disabled globally 60s after one failure; skipped assertions shown as pass | Worker B | in progress |
| B7 | P1 | Keyword body read has no timeout (healthCheck.js) | Worker B | in progress |
| B8 | P1 | Title regex quadratic backtracking; IPv6 2002::/16 etc.; raw error.message as code | Worker A | INTEGRATED (ef0705e) |
| B9 | P1 | exp missing not rejected; JWKS fetch no timeout (api.js) | Worker A | INTEGRATED (ef0705e) |
| B10 | P1 | Malformed % aborts whole batch import (urlParser.js) | Worker B | in progress |
| B11 | P1 | isEmbeddable ignores comma-combined CSP (frameHeaders.js) | Worker A | INTEGRATED (ef0705e) |
| B12 | P2 | Auto-sync fetches fresh ETag before PUT, overwriting remote changes | Orchestrator design first | pending decision |
| B13 | P2 | checkHistory O(n^2) I/O; liveTestModal races | round 2 | pending |
| B14 | P3 | Missing tests: api.js, secureStorage, cryptoVault, cloudApi; jest.config does not collect src/server | round 2 | pending |

## Out of scope (needs human decision)
Cross-isolate rate limiting, expired-session purge and storage caps (Cloudflare infra), IP pinning, npm audit (dev tooling only; --omit=dev is 0), CSRF rotation semantics.

## New from Critic/Challenger (non-blocking)
- B15 (P2): rotation race loser keeps old token_hash, so issueCsrfToken/logout UPDATE matches 0 rows and the returned CSRF token is not stored (api.js ~321-326, ~665). Fix: re-select session when changes !== 1.
- B16 (P3): IPv6 block list misses 3fff::/20, 2001:2::/48, 2001:10::/28, 2001:20::/28 (non-routable, not an SSRF vector).
- B17 (P3): `typeof claims.exp === 'number'` strictness; log cleanupHistory failures; outer readJson catch inconsistency (probe/delete give 500).
- B18 (P3): jest.config.js has no testPathIgnorePatterns for `.claude/`, so `npx jest` in the main checkout also runs worktree copies. Dev-experience only.
