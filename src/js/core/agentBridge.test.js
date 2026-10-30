import { createAgentBridge, isAgentBridgeEnabled } from './agentBridge';

function setup(initial = []) {
  const state = { urls: initial, deleted: [] };
  const normalize = (entries) =>
    entries
      .map((entry) => {
        try {
          new URL(entry.url);
        } catch {
          return null;
        }
        return {
          usageCount: 0,
          lastUsed: 1,
          createdAt: 1,
          isPinned: false,
          label: '',
          tags: [],
          ...entry,
          id: entry.id || `id-${Math.random().toString(36).slice(2, 8)}`,
        };
      })
      .filter(Boolean);
  const commit = jest.fn((next, deleted) => {
    state.urls = next;
    state.deleted.push(...deleted);
  });
  const bridge = createAgentBridge({
    getUrls: () => state.urls,
    normalize,
    commit,
  });
  return { bridge, state, commit };
}

const seed = () => [
  {
    id: 'a',
    url: 'https://a.example/x',
    label: 'Alpha',
    tags: ['qa'],
    usageCount: 0,
    lastUsed: 1,
    createdAt: 1,
    isPinned: false,
  },
  {
    id: 'b',
    url: 'https://b.example/y',
    label: 'Beta',
    tags: ['prod'],
    usageCount: 0,
    lastUsed: 1,
    createdAt: 1,
    isPinned: false,
  },
];

describe('agentBridge', () => {
  test('list filters by query and tag and never mutates', () => {
    const { bridge, commit } = setup(seed());
    expect(bridge.list().total).toBe(2);
    expect(bridge.list({ query: 'alpha' }).items.map((i) => i.id)).toEqual([
      'a',
    ]);
    expect(bridge.list({ tag: 'prod' }).items.map((i) => i.id)).toEqual(['b']);
    expect(bridge.list({ limit: 1 }).items).toHaveLength(1);
    expect(commit).not.toHaveBeenCalled();
  });

  test('add rejects invalid urls and skips duplicates', () => {
    const { bridge, state } = setup(seed());
    const result = bridge.addMany([
      { url: 'https://new.example', label: 'N', tags: ['qa'] },
      { url: 'not a url' },
      { url: 'https://a.example/x' },
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.skipped).toEqual([
      { index: 1, reason: 'invalid_url' },
      { index: 2, reason: 'duplicate' },
    ]);
    expect(state.urls).toHaveLength(3);
  });

  test('add ignores caller-supplied ids and unknown fields', () => {
    const { bridge, state } = setup(seed());
    bridge.add({ url: 'https://c.example', id: 'a', usageCount: 999 });
    const created = state.urls[2];
    expect(created.id).not.toBe('a');
    expect(created.usageCount).toBe(0);
  });

  test('update changes only editable fields', () => {
    const { bridge, state } = setup(seed());
    const result = bridge.update('a', {
      label: 'Renamed',
      usageCount: 50,
      id: 'zzz',
    });
    expect(result.item).toMatchObject({ id: 'a', label: 'Renamed' });
    expect(state.urls[0].usageCount).toBe(0);
    expect(bridge.update('a', {}).error.code).toBe('invalid_input');
    expect(bridge.update('nope', { label: 'x' }).error.code).toBe('not_found');
    expect(bridge.update('a', { url: 'bad' }).error.code).toBe('invalid_url');
  });

  test('remove records deleted ids and undo restores with tombstone cleanup', () => {
    const { bridge, state, commit } = setup(seed());
    expect(bridge.remove(['a']).removed).toEqual(['a']);
    expect(state.deleted).toEqual(['a']);
    expect(bridge.remove('missing').error.code).toBe('not_found');

    expect(bridge.undo().total).toBe(2);
    expect(state.urls.map((u) => u.id)).toEqual(['a', 'b']);
    expect(commit).toHaveBeenLastCalledWith(expect.any(Array), []);
  });

  test('undo of an add tombstones the added entry', () => {
    const { bridge, state } = setup(seed());
    const id = bridge.add({ url: 'https://c.example' }).added[0].id;
    bridge.undo();
    expect(state.urls).toHaveLength(2);
    expect(state.deleted).toContain(id);
    expect(bridge.undo().error.code).toBe('nothing_to_undo');
  });

  test('enforces batch limits and exposes a description', () => {
    const { bridge } = setup();
    const many = Array.from({ length: 201 }, (_, i) => ({
      url: `https://x.example/${i}`,
    }));
    expect(bridge.addMany(many).error.code).toBe('too_many');
    expect(bridge.addMany([]).error.code).toBe('invalid_input');
    expect(bridge.describe().methods).toHaveProperty('undo');
  });
});

describe('isAgentBridgeEnabled', () => {
  const store = (value) => ({ getItem: () => value });
  test('is off by default and opt-in via query or flag', () => {
    expect(isAgentBridgeEnabled({ search: '', storage: store(null) })).toBe(
      false
    );
    expect(
      isAgentBridgeEnabled({ search: '?agent=1', storage: store(null) })
    ).toBe(true);
    expect(isAgentBridgeEnabled({ search: '', storage: store('1') })).toBe(
      true
    );
    expect(
      isAgentBridgeEnabled({ search: '?agent=0', storage: store('0') })
    ).toBe(false);
  });

  test('survives unavailable storage', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    expect(isAgentBridgeEnabled({ search: '', storage: broken })).toBe(false);
  });
});
