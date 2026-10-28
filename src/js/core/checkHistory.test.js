import {
  HISTORY_LIMIT,
  buildResultsCsv,
  flushHistory,
  getHistory,
  pruneHistory,
  recordCheck,
} from './checkHistory';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
}

describe('checkHistory', () => {
  test('records results and detects regression / recovery', () => {
    const store = memoryStorage();
    const first = recordCheck('a', { status: 'online', code: 200 }, store, 1);
    expect(first).toMatchObject({ regression: false, recovered: false });

    const bad = recordCheck(
      'a',
      { status: 'offline', code: 503, error: 'HTTP 503' },
      store,
      2
    );
    expect(bad.regression).toBe(true);

    const back = recordCheck('a', { status: 'online' }, store, 3);
    expect(back.recovered).toBe(true);
    expect(getHistory('a', store).map((r) => r.ok)).toEqual([
      true,
      false,
      true,
    ]);
  });

  test('keeps only the most recent entries', () => {
    const store = memoryStorage();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      recordCheck('a', { status: 'online', timeMs: i }, store, i);
    }
    const history = getHistory('a', store);
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[history.length - 1].ms).toBe(HISTORY_LIMIT + 4);
  });

  test('survives corrupt storage and unavailable storage', () => {
    const store = memoryStorage();
    store.setItem('urlEditorCheckHistory', '{not json');
    expect(getHistory('a', store)).toEqual([]);
    expect(() => recordCheck('a', { status: 'online' }, store)).not.toThrow();

    const quiet = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(() =>
      recordCheck('a', { status: 'online' }, throwing)
    ).not.toThrow();
    flushHistory();
    quiet.mockRestore();
  });

  test('prunes history of deleted entries', () => {
    const store = memoryStorage();
    recordCheck('keep', { status: 'online' }, store);
    recordCheck('gone', { status: 'online' }, store);
    pruneHistory(['keep'], store);
    expect(getHistory('gone', store)).toEqual([]);
    expect(getHistory('keep', store)).toHaveLength(1);
  });
});

describe('checkHistory caching and batching', () => {
  test('N recordCheck + getHistory calls parse once and write once', () => {
    const store = memoryStorage();
    const setSpy = jest.spyOn(store, 'setItem');
    const parseSpy = jest.spyOn(JSON, 'parse');
    for (let i = 0; i < 100; i++) {
      recordCheck(`id${i % 20}`, { status: 'online' }, store, i);
      getHistory(`id${i % 20}`, store);
    }
    expect(parseSpy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(setSpy).not.toHaveBeenCalled(); // debounced
    flushHistory();
    expect(setSpy).toHaveBeenCalledTimes(1);
    parseSpy.mockRestore();
    const persisted = JSON.parse(store.getItem('urlEditorCheckHistory'));
    expect(Object.keys(persisted)).toHaveLength(20);
  });

  test('debounced write lands after the delay', () => {
    jest.useFakeTimers();
    try {
      const store = memoryStorage();
      recordCheck('t', { status: 'online' }, store, 1);
      expect(store.getItem('urlEditorCheckHistory')).toBeNull();
      jest.advanceTimersByTime(1000);
      expect(store.getItem('urlEditorCheckHistory')).toContain('"t"');
    } finally {
      jest.useRealTimers();
    }
  });

  test('picks up changes written by another tab', () => {
    const store = memoryStorage();
    recordCheck('a', { status: 'online' }, store, 1);
    flushHistory();
    store.setItem(
      'urlEditorCheckHistory',
      JSON.stringify({ a: [{ t: 9, ok: false }] })
    );
    expect(getHistory('a', store)).toEqual([{ t: 9, ok: false }]);
  });

  test('drops null / non-object elements from corrupt data', () => {
    const store = memoryStorage();
    store.setItem(
      'urlEditorCheckHistory',
      JSON.stringify({ a: [null, 5, 'x', [1], { t: 1, ok: true }], b: 'bad' })
    );
    expect(getHistory('a', store)).toEqual([{ t: 1, ok: true }]);
    expect(getHistory('b', store)).toEqual([]);
  });

  test('quota failure does not crash, warns once and keeps memory history', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const store = memoryStorage();
    store.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    recordCheck('q', { status: 'online' }, store, 1);
    expect(() => flushHistory()).not.toThrow();
    recordCheck('q', { status: 'offline' }, store, 2);
    flushHistory();
    expect(getHistory('q', store)).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('buildResultsCsv', () => {
  test('quotes cells and neutralises formula injection', () => {
    const csv = buildResultsCsv(
      [
        { id: '1', url: 'https://a.test/?q=1,2', label: '=HYPERLINK("x")' },
        { id: '2', url: 'https://b.test' },
      ],
      new Map([
        [
          '1',
          {
            status: 'offline',
            code: 500,
            error: 'HTTP 500',
            mode: 'server',
            assertion: { passed: false },
          },
        ],
      ]),
      0
    );
    const lines = csv.split('\n');
    expect(lines[0]).toContain('label,url,status');
    expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
    expect(lines[1]).toContain('"https://a.test/?q=1,2"');
    expect(lines[1]).toContain(',fail,');
    expect(lines[2].startsWith(',https://b.test')).toBe(true);
  });

  test('maps assertion state to pass, fail or skipped (legacy passed-only still works)', () => {
    const entries = ['a', 'b', 'c', 'd', 'e'].map((id) => ({
      id,
      url: `https://${id}.test`,
    }));
    const online = { status: 'online', mode: 'limited' };
    const csv = buildResultsCsv(
      entries,
      new Map([
        ['a', { ...online, assertion: { passed: true, state: 'passed' } }],
        ['b', { ...online, assertion: { passed: false, state: 'failed' } }],
        ['c', { ...online, assertion: { passed: false, state: 'skipped' } }],
        ['d', { ...online, assertion: { passed: true } }],
        ['e', { ...online, assertion: { passed: false } }],
      ]),
      0
    );
    const cells = csv
      .split('\n')
      .slice(1)
      .map((line) => line.split(',')[7]);
    expect(cells).toEqual(['pass', 'fail', 'skipped', 'pass', 'fail']);
  });

  test('an all-skipped assertion does not count as a failure in history', () => {
    const store = memoryStorage();
    recordCheck('x', { status: 'online' }, store, 1);
    const out = recordCheck(
      'x',
      {
        status: 'online',
        assertion: { passed: false, state: 'skipped', failures: [] },
      },
      store,
      2
    );
    expect(out.record.ok).toBe(true);
    expect(out.regression).toBe(false);
  });
});
