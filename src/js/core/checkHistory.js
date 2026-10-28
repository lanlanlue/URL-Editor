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

function load(storage) {
  const target = getStorage(storage);
  if (!target) return {};
  try {
    const parsed = JSON.parse(target.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function save(data, storage) {
  const target = getStorage(storage);
  if (!target) return;
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Quota or privacy mode: history is best-effort.
  }
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
    const assertion = res.assertion
      ? res.assertion.passed
        ? 'pass'
        : 'fail'
      : '';
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
