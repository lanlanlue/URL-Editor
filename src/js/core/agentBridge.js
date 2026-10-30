export const AGENT_FLAG_KEY = 'urlEditorAgent';
export const AGENT_QUERY_PARAM = 'agent';
export const AGENT_BRIDGE_VERSION = 1;

const MAX_BATCH = 200;
const MAX_UNDO = 20;
const EDITABLE_FIELDS = ['url', 'label', 'tags', 'isPinned'];

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

function toPublic(entry) {
  return {
    id: entry.id,
    url: entry.url,
    label: entry.label,
    tags: [...entry.tags],
    isPinned: entry.isPinned === true,
    usageCount: entry.usageCount,
    createdAt: entry.createdAt,
    lastUsed: entry.lastUsed,
  };
}

function pickEditable(input) {
  const picked = {};
  EDITABLE_FIELDS.forEach((field) => {
    if (input && Object.prototype.hasOwnProperty.call(input, field)) {
      picked[field] = input[field];
    }
  });
  return picked;
}

/**
 * Whether the agent bridge may be installed. It is opt-in: either the page was
 * opened with `?agent=1`, or the user set the localStorage flag themselves.
 * @param {{search?: string, storage?: Storage}} [env]
 * @returns {boolean}
 */
export function isAgentBridgeEnabled(env = {}) {
  const search =
    env.search ?? (typeof window !== 'undefined' ? window.location.search : '');
  try {
    if (new URLSearchParams(search).get(AGENT_QUERY_PARAM) === '1') return true;
  } catch {
    // fall through to storage
  }
  try {
    const storage =
      env.storage ??
      (typeof localStorage !== 'undefined' ? localStorage : null);
    return storage?.getItem(AGENT_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Creates the machine-facing API used by an LLM driving the page. All writes go
 * through `commit`, which the host wires to its normal save path, so encryption
 * and cloud sync behave exactly as for edits made in the UI.
 *
 * @param {object} host
 * @param {() => object[]} host.getUrls      current entries
 * @param {(entries: object[]) => object[]} host.normalize  validates/normalizes entries
 * @param {(next: object[], deletedIds: string[]) => void} host.commit
 *        replaces the list, records tombstones, saves and re-renders
 */
export function createAgentBridge(host) {
  const undoStack = [];

  function snapshot() {
    undoStack.push(host.getUrls().map((entry) => ({ ...entry })));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  function normalizeOne(raw, existing) {
    const merged = existing ? { ...existing, ...pickEditable(raw) } : raw;
    const [normalized] = host.normalize([merged]);
    return normalized || null;
  }

  function list({ query, tag, limit } = {}) {
    let entries = host.getUrls();
    if (typeof tag === 'string' && tag) {
      entries = entries.filter((entry) => entry.tags.includes(tag));
    }
    if (typeof query === 'string' && query.trim()) {
      const needle = query.trim().toLowerCase();
      entries = entries.filter(
        (entry) =>
          entry.url.toLowerCase().includes(needle) ||
          entry.label.toLowerCase().includes(needle) ||
          entry.tags.some((t) => t.toLowerCase().includes(needle))
      );
    }
    const total = entries.length;
    if (Number.isInteger(limit) && limit > 0) entries = entries.slice(0, limit);
    return { ok: true, total, items: entries.map(toPublic) };
  }

  function get(id) {
    const entry = host.getUrls().find((item) => item.id === id);
    return entry
      ? { ok: true, item: toPublic(entry) }
      : fail('not_found', `No entry with id "${id}".`);
  }

  function add(input) {
    return addMany([input]);
  }

  function addMany(inputs, { skipDuplicates = true } = {}) {
    if (!Array.isArray(inputs) || inputs.length === 0) {
      return fail('invalid_input', 'Expected a non-empty array.');
    }
    if (inputs.length > MAX_BATCH) {
      return fail('too_many', `At most ${MAX_BATCH} entries per call.`);
    }
    const current = host.getUrls();
    const known = new Set(current.map((entry) => entry.url));
    const added = [];
    const skipped = [];
    const created = [];
    inputs.forEach((raw, index) => {
      const entry = normalizeOne({ ...pickEditable(raw), id: undefined });
      if (!entry) {
        skipped.push({ index, reason: 'invalid_url' });
        return;
      }
      if (skipDuplicates && known.has(entry.url)) {
        skipped.push({ index, reason: 'duplicate' });
        return;
      }
      known.add(entry.url);
      created.push(entry);
      added.push(toPublic(entry));
    });
    if (created.length) {
      snapshot();
      host.commit([...current, ...created], []);
    }
    return { ok: true, added, skipped };
  }

  function update(id, patch) {
    const current = host.getUrls();
    const existing = current.find((entry) => entry.id === id);
    if (!existing) return fail('not_found', `No entry with id "${id}".`);
    const fields = pickEditable(patch);
    if (Object.keys(fields).length === 0) {
      return fail(
        'invalid_input',
        `Provide at least one of: ${EDITABLE_FIELDS.join(', ')}.`
      );
    }
    const next = normalizeOne(fields, existing);
    if (!next) return fail('invalid_url', 'The resulting URL is not valid.');
    next.id = existing.id;
    snapshot();
    host.commit(
      current.map((entry) => (entry.id === id ? next : entry)),
      []
    );
    return { ok: true, item: toPublic(next) };
  }

  function remove(ids) {
    const wanted = new Set(Array.isArray(ids) ? ids : [ids]);
    const current = host.getUrls();
    const doomed = current.filter((entry) => wanted.has(entry.id));
    if (doomed.length === 0) return fail('not_found', 'No matching entries.');
    snapshot();
    host.commit(
      current.filter((entry) => !wanted.has(entry.id)),
      doomed.map((entry) => entry.id)
    );
    return { ok: true, removed: doomed.map((entry) => entry.id) };
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return fail('nothing_to_undo', 'No earlier state.');
    const currentIds = new Set(host.getUrls().map((entry) => entry.id));
    const restoredIds = new Set(previous.map((entry) => entry.id));
    // Entries that the undo drops again must be tombstoned so sync removes them.
    const dropped = [...currentIds].filter((id) => !restoredIds.has(id));
    host.commit(previous, dropped);
    return { ok: true, total: previous.length };
  }

  function describe() {
    return {
      ok: true,
      version: AGENT_BRIDGE_VERSION,
      editableFields: EDITABLE_FIELDS,
      maxBatch: MAX_BATCH,
      methods: {
        list: '({query?, tag?, limit?}) -> {total, items}',
        get: '(id) -> {item}',
        add: '({url, label?, tags?, isPinned?}) -> {added, skipped}',
        addMany: '([{url,...}], {skipDuplicates?=true}) -> {added, skipped}',
        update: '(id, {url?, label?, tags?, isPinned?}) -> {item}',
        remove: '(id | id[]) -> {removed}',
        undo: '() -> {total}  // reverts the last write (up to 20 steps)',
      },
    };
  }

  return Object.freeze({
    describe,
    list,
    get,
    add,
    addMany,
    update,
    remove,
    undo,
  });
}

export default createAgentBridge;
