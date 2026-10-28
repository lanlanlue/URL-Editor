/**
 * Local-only history of health-check outcomes per URL entry.
 *
 * Stored under its own localStorage key, NOT on the entries: entries are
 * change-detected and synced to the cloud, and every check would otherwise
 * count as an edit.
 */

const STORAGE_KEY = 'urlEditorCheckHistory';
// Small side key: { [prunedId]: pruneTimestamp }. Lets a tab that flushes later
// drop its own pending records of an id another tab already pruned, without a
// format change to the history blob.
const PRUNED_KEY = 'urlEditorCheckHistoryPruned';
const PRUNED_MAX = 200;
export const HISTORY_LIMIT = 20;

function getStorage(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Per storage object we keep:
 *  - `raw` / `data`: the last parsed copy of the stored blob. A cheap raw
 *    string comparison (no JSON.parse) detects writes by other tabs, so reads
 *    always reflect fresh storage.
 *  - `pending`: records appended locally and not yet written.
 *
 * Writes are additive. A flush re-reads the CURRENT storage string, appends the
 * pending records per id (de-duplicated by record key, capped), and writes
 * once. Another tab's records are therefore never overwritten by a stale blob,
 * and a run of N checks costs O(1) parses and writes instead of O(N).
 */
const FLUSH_DELAY_MS = 300;
const cache = new WeakMap(); // storage -> { raw, data, pending: Map, timer, warned }
const dirtyTargets = new Set();
let lifecycleHooked = false;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Drops non-array values and non-object elements from a parsed blob. */
function sanitize(parsed) {
  if (!isRecord(parsed)) return {};
  const clean = {};
  Object.keys(parsed).forEach((id) => {
    if (Array.isArray(parsed[id])) clean[id] = parsed[id].filter(isRecord);
  });
  return clean;
}

let recordSeq = 0;
const INSTANCE_TAG = Math.random().toString(36).slice(2, 8);

/** Unique per recorded check, so identical-looking results are not merged. */
function newRecordId() {
  recordSeq += 1;
  return `${INSTANCE_TAG}${recordSeq.toString(36)}`;
}

// Stable de-duplication key; legacy records without `r` fall back to content.
function recordKey(record) {
  if (record.r) return record.r;
  return [
    record.t,
    record.ok,
    record.code,
    record.ms,
    record.err,
    record.mode,
  ].join('|');
}

function recordTime(record) {
  return Number.isFinite(record.t) ? record.t : -Infinity;
}

/**
 * Merges `extra` into `base`, skipping duplicates, ordered by record time `t`
 * (stable: ties keep append order, so base precedes extra), then keeps the
 * newest HISTORY_LIMIT by time. Records without a numeric `t` (legacy or
 * corrupt) sort oldest. Ordering by time, not by flush order, keeps the cap
 * and "previous" correct when several tabs flush out of order.
 */
function mergeRecords(base = [], extra = []) {
  const seen = new Set(base.map(recordKey));
  const merged = [...base];
  extra.forEach((record) => {
    const key = recordKey(record);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(record);
    }
  });
  // Array.prototype.sort is stable (ES2019).
  merged.sort((a, b) => {
    const ta = recordTime(a);
    const tb = recordTime(b);
    if (ta === tb) return 0;
    return ta < tb ? -1 : 1;
  });
  return merged.slice(-HISTORY_LIMIT);
}

function getEntry(target) {
  let entry = cache.get(target);
  if (!entry) {
    entry = {
      raw: undefined,
      data: {},
      pending: new Map(),
      prunedRaw: undefined,
      pruned: {},
      timer: null,
      warned: false,
    };
    cache.set(target, entry);
  }
  return entry;
}

/** Fresh stored blob; parses only when the raw string changed. */
function loadFresh(target) {
  const entry = getEntry(target);
  let raw;
  try {
    raw = target.getItem(STORAGE_KEY);
  } catch {
    return entry.data;
  }
  if (entry.raw === raw) return entry.data;
  let data = {};
  try {
    data = sanitize(JSON.parse(raw || '{}'));
  } catch {
    data = {};
  }
  entry.raw = raw;
  entry.data = data;
  return data;
}

/** Prune markers written by any tab; parses only when the raw string changed. */
function loadPruned(target, entry) {
  let raw;
  try {
    raw = target.getItem(PRUNED_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  if (entry.prunedRaw === raw) return entry.pruned;
  let marks = {};
  try {
    const parsed = JSON.parse(raw);
    if (isRecord(parsed)) {
      Object.keys(parsed).forEach((id) => {
        if (Number.isFinite(parsed[id])) marks[id] = parsed[id];
      });
    }
  } catch {
    marks = {};
  }
  entry.prunedRaw = raw;
  entry.pruned = marks;
  return marks;
}

/** Keeps only pending records newer than the id's prune marker, if any. */
function dropPrunedRecords(records, prunedAt) {
  if (prunedAt === undefined) return records;
  return records.filter((record) => recordTime(record) > prunedAt);
}

/** Stores prune markers for `ids` (best effort), bounded to PRUNED_MAX. */
function markPruned(target, entry, ids, now) {
  const marks = { ...loadPruned(target, entry) };
  ids.forEach((id) => {
    marks[id] = now;
  });
  const kept = Object.keys(marks)
    .sort((a, b) => marks[b] - marks[a])
    .slice(0, PRUNED_MAX);
  const next = {};
  kept.forEach((id) => {
    next[id] = marks[id];
  });
  try {
    const raw = JSON.stringify(next);
    target.setItem(PRUNED_KEY, raw);
    entry.prunedRaw = raw;
    entry.pruned = next;
  } catch {
    // Best-effort: without a marker the other tab may write the id back once.
  }
}

function flushTarget(target) {
  const entry = cache.get(target);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  if (!entry.pending.size) {
    dirtyTargets.delete(target);
    return;
  }
  const next = { ...loadFresh(target) };
  const pruned = loadPruned(target, entry);
  entry.pending.forEach((all, id) => {
    const records = dropPrunedRecords(all, pruned[id]);
    if (records.length) next[id] = mergeRecords(next[id], records);
  });
  try {
    const raw = JSON.stringify(next);
    target.setItem(STORAGE_KEY, raw);
    entry.raw = raw;
    entry.data = next;
    entry.pending.clear();
    entry.warned = false;
    dirtyTargets.delete(target);
  } catch (err) {
    // Quota or privacy mode: records stay pending in memory for this session.
    if (!entry.warned) {
      entry.warned = true;
      console.warn('[checkHistory] could not persist history:', err);
    }
  }
}

/** Writes any pending history immediately (also runs on page hide). */
export function flushHistory() {
  [...dirtyTargets].forEach(flushTarget);
}

function hookLifecycle() {
  if (lifecycleHooked || typeof window === 'undefined') return;
  lifecycleHooked = true;
  window.addEventListener('pagehide', flushHistory);
  window.addEventListener('beforeunload', flushHistory);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushHistory();
  });
}

function scheduleFlush(target, entry) {
  dirtyTargets.add(target);
  hookLifecycle();
  if (!entry.timer) {
    entry.timer = setTimeout(() => flushTarget(target), FLUSH_DELAY_MS);
  }
}

function readRecords(id, storage) {
  const target = getStorage(storage);
  if (!target) return [];
  const entry = getEntry(target);
  const fresh = loadFresh(target)[id];
  return mergeRecords(
    Array.isArray(fresh) ? fresh : [],
    entry.pending.get(id) || []
  );
}

/** Forgets the in-memory copy (tests, explicit reset). Pending writes flush first. */
export function resetHistoryCache(storage) {
  const target = getStorage(storage);
  if (!target) return;
  flushTarget(target);
  cache.delete(target);
}

/** @returns {Array<{t: number, ok: boolean, code?: number, ms?: number, err?: string, mode?: string}>} */
export function getHistory(id, storage) {
  return readRecords(id, storage);
}

/**
 * Appends a result and reports whether it changed state versus the last run.
 * @returns {{record: object, previous: object|null, regression: boolean, recovered: boolean}}
 */
export function recordCheck(id, result, storage, now = Date.now()) {
  const records = readRecords(id, storage);
  const previous = records[records.length - 1] || null;
  const record = {
    t: now,
    r: newRecordId(),
    ok: result.status === 'online',
    ...(result.code != null ? { code: result.code } : {}),
    ...(typeof result.timeMs === 'number' ? { ms: result.timeMs } : {}),
    ...(result.error ? { err: String(result.error).slice(0, 120) } : {}),
    ...(result.mode ? { mode: result.mode } : {}),
  };
  const target = getStorage(storage);
  if (target) {
    const entry = getEntry(target);
    entry.pending.set(id, mergeRecords(entry.pending.get(id) || [], [record]));
    scheduleFlush(target, entry);
  }
  return {
    record,
    previous,
    regression: Boolean(previous?.ok) && !record.ok,
    recovered: previous ? !previous.ok && record.ok : false,
  };
}

/**
 * Drops history for entries that no longer exist (stored and pending) and
 * leaves a timestamped marker so other tabs do not write older pending records
 * of those ids back. Only records newer than the prune can recreate an id.
 */
export function pruneHistory(validIds, storage, now = Date.now()) {
  const target = getStorage(storage);
  if (!target) return;
  const keep = new Set(validIds);
  const entry = getEntry(target);
  entry.pending.forEach((_records, id) => {
    if (!keep.has(id)) entry.pending.delete(id);
  });
  const fresh = loadFresh(target);
  const stale = Object.keys(fresh).filter((id) => !keep.has(id));
  if (!stale.length) return;
  // Known limitation: only ids present in the stored blob get a marker. An id
  // that exists solely in another tab's unflushed pending records cannot be
  // detected here and is written back by that tab at its next flush.
  markPruned(target, entry, stale, now);
  const next = { ...fresh };
  stale.forEach((id) => delete next[id]);
  try {
    const raw = JSON.stringify(next);
    target.setItem(STORAGE_KEY, raw);
    entry.raw = raw;
    entry.data = next;
  } catch {
    // Best-effort: the blob keeps the stale ids until the next successful write.
  }
}

/**
 * CSV label for an assertion outcome. Prefers `state`; results that only carry
 * `passed` (older shape) map to pass/fail.
 */
function describeAssertion(assertion) {
  if (!assertion) return '';
  if (assertion.state === 'skipped') return 'skipped';
  if (assertion.state === 'passed') return 'pass';
  if (assertion.state === 'failed') return 'fail';
  return assertion.passed ? 'pass' : 'fail';
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  // Neutralise spreadsheet formula injection, then quote if needed.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Builds a CSV of the latest results.
 * @param {Array<{id: string, url: string, label?: string}>} entries
 * @param {Map<string, object>} results
 */
export function buildResultsCsv(entries, results, now = Date.now()) {
  const header = [
    'label',
    'url',
    'status',
    'http_code',
    'time_ms',
    'mode',
    'final_url',
    'assertion',
    'error',
    'checked_at',
  ];
  const rows = entries.map((entry) => {
    const res = results.get(entry.id) || {};
    const assertion = describeAssertion(res.assertion);
    return [
      entry.label || '',
      entry.url,
      res.status || '',
      res.code ?? '',
      res.timeMs ?? '',
      res.mode || '',
      res.finalUrl || '',
      assertion,
      res.error || '',
      new Date(now).toISOString(),
    ]
      .map(csvCell)
      .join(',');
  });
  return [header.join(','), ...rows].join('\n');
}
