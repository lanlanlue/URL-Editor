# B12 design proposal: auto-sync must merge, not overwrite

Status: PROPOSAL, not implemented. Needs a user decision.
Base: main at a12b4a5. Evidence: read of src/js/ui/modals/cloudSyncModal.js (not yet reproduced by a test).

## Problem
`uploadCurrentData` (cloudSyncModal.js:471-526):
1. calls `refreshRemoteDocument()` which stores the server's CURRENT etag and revision;
2. encrypts only `callbacks.getData()` (local data);
3. PUTs with `If-Match` = that just-fetched etag.

The etag always matches, so the server never answers 409, and the merge branch (lines 514-522) is almost unreachable. Merging only happens at session refresh (lines ~349-353) and on the rare 409.

Failure scenario: device A and B are both open. A uploads revision 5. B, which last merged at revision 4, edits something; its auto-sync fetches etag of revision 5 and replaces revision 5 with B's local state. A's edits are missing from the current revision (recoverable only through revision history).

Interaction: the B19 placeholder guard is safe today only because the placeholder is never uploaded; B12 would also let any stale-but-real state overwrite newer remote data.

## Option A: merge before upload
After `refreshRemoteDocument()`, if `remoteDocument.revision` is greater than the last revision this device merged or uploaded (`lastSyncedRevision`), decrypt the remote, `mergeSyncData(local, remote)`, `restoreData(merged)`, then encrypt the merged data and PUT with the fresh etag. The existing 409 path still covers the small race between refresh and PUT.
- Pro: explicit, no dependence on a failed request round trip; one extra decrypt only when remote changed.
- Con: more code in the upload path; one more place that calls `restoreData`.

## Option B (recommended): keep the last synced etag and let the server arbitrate
Track `syncedEtag` and `syncedRevision` (set after a merge at session refresh, after a successful upload and after the 409 merge). `uploadCurrentData` stops fetching a fresh etag before the PUT; it uses `syncedEtag` as `If-Match` and `syncedRevision + 1` for the envelope. If the remote moved, the server answers 409 and the EXISTING 409 branch refreshes, merges and retries once.
- Pro: smallest change, uses the merge path that is already written and (after B14) covered on the server side; server stays the arbiter.
- Con: a stale `syncedEtag` after an unexpected path would 409 repeatedly; the retry is bounded (`retry:false` throws), so it surfaces as an error rather than a silent overwrite, which is the safe failure.

## Tests (required either way)
Two simulated devices over a fake cloudApi that implements ETag/If-Match like src/server/api.js: (1) stale device B uploads after A: result must contain both A's and B's edits; (2) B deletes an entry A edited later: LWW by sync stamps, tombstone respected; (3) up-to-date device uploads without extra requests; (4) 409 retry bound: persistent conflict ends in an error, never an overwrite; (5) B19 placeholder guard still blocks uploads.

## Risks
- Touches the sync path used by every cloud user; must be tested against a staging deployment, not only unit tests.
- Merge semantics depend on `syncMerge.js` and the B2 fix (remote stamps preserved on restore). Tombstones are never pruned (known, separate).
- Owned files: cloudSyncModal.js and cloudSyncModal.test.js only (plus optional new two-device test file). Effort: M.

## Decision requested
Approve Option B (recommended), choose Option A, or leave B12 open.
