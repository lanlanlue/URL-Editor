/**
 * Local-only history of health-check outcomes per URL entry.
 *
 * Stored under its own localStorage key, NOT on the entries: entries are
 * change-detected and synced to the cloud, and every check would otherwise
 * count as an edit.
 */

const STORAGE_KEY = 'urlEditorCheckHistory';
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
 * In-memory cache per storage object. Parsing and re-serialising the whole
 * blob on every call made a run of N checks O(N^2), so the parsed blob is kept
 * here, writes are coalesced into one debounced setItem, and a cheap raw-string
 * comparison (no JSON.parse) picks up changes made by other tabs.
 */
const FLUSH_DELAY_MS = 300;
const cache = new WeakMap(); // storage -> { raw, data, dirty, timer }
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

function flushTarget(target) {
  const entry = cache.get(target);
  if (!entry || !entry.dirty) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = null;
  entry.dirty = false;
  dirtyTargets.delete(target);
  try {
    const raw = JSON.stringify(entry.data);
    target.setItem(STORAGE_KEY, raw);
    entry.raw = raw;
    entry.warned = false;
  } catch (err) {
    // Quota or privacy mode: history stays in memory for this session.
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

function load(storage) {
  const target = getStorage(storage);
  if (!target) return {};
  const entry = cache.get(target);
  if (entry?.dirty) return entry.data;
  let raw = null;
  try {
    raw = target.getItem(STORAGE_KEY);
  } catch {
    return entry ? entry.data : {};
  }
  if (entry && entry.raw === raw) return entry.data;
  let data = {};
  try {
    data = sanitize(JSON.parse(raw || '{}'));
  } catch {
    data = {};
  }
  cache.set(target, { raw, data, dirty: false, timer: null });
  return data;
}

function save(data, storage) {
  const target = getStorage(storage);
  if (!target) return;
  let entry = cache.get(target);
  if (!entry) {
    entry = { raw: null, data, dirty: false, timer: null };
    cache.set(target, entry);
  }
  entry.data = data;
  entry.dirty = true;
  dirtyTargets.add(target);
  hookLifecycle();
  if (!entry.timer) {
    entry.timer = setTimeout(() => flushTarget(target), FLUSH_DELAY_MS);
  }
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
  const records = load(storage)[id];
  return Array.isArray(records) ? records : [];
}

/**
 * Appends a result and reports whether it changed state versus the last run.
 * @returns {{record: object, previous: object|null, regression: boolean, recovered: boolean}}
 */
export function recordCheck(id, result, storage, now = Date.now()) {
  const data = load(storage);
  const records = Array.isArray(data[id]) ? data[id] : [];
  const previous = records[records.length - 1] || null;
  const record = {
    t: now,
    ok: result.status === 'online',
    ...(result.code != null ? { code: result.code } : {}),
    ...(typeof result.timeMs === 'number' ? { ms: result.timeMs } : {}),
    ...(result.error ? { err: String(result.error).slice(0, 120) } : {}),
    ...(result.mode ? { mode: result.mode } : {}),
  };
  data[id] = [...records, record].slice(-HISTORY_LIMIT);
  save(data, storage);
  return {
    record,
    previous,
    regression: Boolean(previous?.ok) && !record.ok,
    recovered: previous ? !previous.ok && record.ok : false,
  };
}

/** Drops history for entries that no longer exist. */
export function pruneHistory(validIds, storage) {
  const keep = new Set(validIds);
  const data = load(storage);
  let changed = false;
  Object.keys(data).forEach((id) => {
    if (!keep.has(id)) {
      delete data[id];
      changed = true;
    }
  });
  if (changed) save(data, storage);
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
