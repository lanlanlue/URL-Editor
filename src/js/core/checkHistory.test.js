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

describe('checkHistory with two tabs on one storage', () => {
  function loadInstance() {
    let mod;
    jest.isolateModules(() => {
      mod = require('./checkHistory');
    });
    return mod;
  }
  const idsOf = (store) =>
    Object.keys(JSON.parse(store.getItem('urlEditorCheckHistory') || '{}'));

  afterEach(() => {
    jest.useRealTimers();
  });

  test('records from both tabs survive after both flush', () => {
    const store = memoryStorage();
    const A = loadInstance();
    const B = loadInstance();
    A.recordCheck('x', { status: 'online' }, store, 1);
    B.recordCheck('y', { status: 'online' }, store, 2);
    A.recordCheck('x', { status: 'offline' }, store, 3);
    A.flushHistory();
    B.flushHistory();
    const persisted = JSON.parse(store.getItem('urlEditorCheckHistory'));
    expect(persisted.x).toHaveLength(2);
    expect(persisted.y).toHaveLength(1);
    // A fresh reader sees everything.
    const C = loadInstance();
    expect(C.getHistory('x', store)).toHaveLength(2);
    expect(C.getHistory('y', store)).toHaveLength(1);
  });

  test('two tabs recording 50 distinct ids interleaved lose nothing', () => {
    jest.useFakeTimers();
    const store = memoryStorage();
    const A = loadInstance();
    const B = loadInstance();
    for (let i = 0; i < 50; i += 1) {
      A.recordCheck(`a${i}`, { status: 'online' }, store, i);
      jest.advanceTimersByTime(12);
      B.recordCheck(`b${i}`, { status: 'online' }, store, i);
      jest.advanceTimersByTime(13);
    }
    A.flushHistory();
    B.flushHistory();
    expect(idsOf(store)).toHaveLength(100);
  });

  test('reads return fresh storage records plus local pending ones', () => {
    const store = memoryStorage();
    const A = loadInstance();
    const B = loadInstance();
    A.recordCheck('x', { status: 'online' }, store, 1);
    A.flushHistory();
    B.recordCheck('x', { status: 'offline' }, store, 2); // pending in B
    expect(B.getHistory('x', store).map((r) => r.t)).toEqual([1, 2]);
    A.recordCheck('x', { status: 'online' }, store, 3);
    A.flushHistory();
    expect(B.getHistory('x', store).map((r) => r.t)).toEqual([1, 2, 3]);
  });

  test('a repeated flush never duplicates records and the cap holds', () => {
    const store = memoryStorage();
    const A = loadInstance();
    const B = loadInstance();
    for (let i = 0; i < A.HISTORY_LIMIT + 5; i += 1) {
      A.recordCheck('x', { status: 'online' }, store, i);
    }
    A.flushHistory();
    A.flushHistory();
    B.recordCheck('x', { status: 'online' }, store, 1000);
    B.flushHistory();
    B.flushHistory();
    const persisted = JSON.parse(store.getItem('urlEditorCheckHistory')).x;
    expect(persisted).toHaveLength(A.HISTORY_LIMIT);
    expect(persisted.filter((r) => r.t === 1000)).toHaveLength(1);
  });

  test('records are ordered by time, not by flush order', () => {
    const store = memoryStorage();
    const A = loadInstance();
    const B = loadInstance();
    A.recordCheck('x', { status: 'online' }, store, 10);
    A.recordCheck('x', { status: 'online' }, store, 30);
    B.recordCheck('x', { status: 'offline' }, store, 20);
    A.flushHistory();
    B.flushHistory(); // flushed last but older than A's newest
    const persisted = JSON.parse(store.getItem('urlEditorCheckHistory')).x;
    expect(persisted.map((r) => r.t)).toEqual([10, 20, 30]);
    expect(A.getHistory('x', store).map((r) => r.t)).toEqual([10, 20, 30]);
  });

  test('the cap keeps the newest by time even when flushed out of order', () => {
    const store = memoryStorage();
    const A = loadInstance();
    const B = loadInstance();
    const limit = A.HISTORY_LIMIT;
    for (let i = 0; i < limit; i += 1) {
      A.recordCheck('x', { status: 'online' }, store, 100 + i);
    }
    A.flushHistory(); // stored: full
    B.recordCheck('x', { status: 'offline' }, store, 50); // older than all
    B.recordCheck('x', { status: 'offline' }, store, 150); // newer than all
    B.flushHistory();
    const ts = JSON.parse(store.getItem('urlEditorCheckHistory')).x.map(
      (r) => r.t
    );
    expect(ts).toHaveLength(limit);
    expect(ts).not.toContain(50); // the old-by-time record loses
    expect(ts[0]).toBe(101); // 100 is dropped only because 150 is newer
    expect(ts[ts.length - 1]).toBe(150);
  });

  test('previous is the newest by time, not the last appended', () => {
    const store = memoryStorage();
    const A = loadInstance();
    const B = loadInstance();
    A.recordCheck('x', { status: 'online' }, store, 100);
    A.flushHistory();
    B.recordCheck('x', { status: 'offline' }, store, 50);
    B.flushHistory(); // appended after, but older
    const C = loadInstance();
    const out = C.recordCheck('x', { status: 'offline' }, store, 200);
    expect(out.previous.t).toBe(100);
    expect(out.regression).toBe(true);
  });

  test('equal timestamps keep append order and are not merged', () => {
    const store = memoryStorage();
    const A = loadInstance();
    const B = loadInstance();
    A.recordCheck('x', { status: 'online', timeMs: 1 }, store, 5);
    A.flushHistory();
    B.recordCheck('x', { status: 'online', timeMs: 2 }, store, 5);
    B.recordCheck('x', { status: 'online', timeMs: 3 }, store, 5);
    B.flushHistory();
    const persisted = JSON.parse(store.getItem('urlEditorCheckHistory')).x;
    expect(persisted.map((r) => r.ms)).toEqual([1, 2, 3]);
  });

  test('legacy records without r or t are kept and sort oldest', () => {
    const store = memoryStorage();
    store.setItem(
      'urlEditorCheckHistory',
      JSON.stringify({ x: [{ t: 7, ok: true }, { ok: false }, null] })
    );
    const A = loadInstance();
    A.recordCheck('x', { status: 'online' }, store, 3);
    A.flushHistory();
    const persisted = JSON.parse(store.getItem('urlEditorCheckHistory')).x;
    expect(persisted).toHaveLength(3);
    expect(persisted[0]).toEqual({ ok: false });
    expect(persisted[persisted.length - 1].t).toBe(7);
  });

  test('prune neither resurrects nor loses the other tab records', () => {
    const store = memoryStorage();
    const A = loadInstance();
    const B = loadInstance();
    A.recordCheck('keep', { status: 'online' }, store, 1);
    A.recordCheck('gone', { status: 'online' }, store, 2);
    A.flushHistory();
    B.recordCheck('keepB', { status: 'online' }, store, 3);
    B.flushHistory();
    // A prunes: only 'keep' and 'keepB' are valid.
    A.pruneHistory(['keep', 'keepB'], store);
    expect(idsOf(store).sort()).toEqual(['keep', 'keepB']);
    // A records again and flushes; B's record and the prune both stick.
    A.recordCheck('keep', { status: 'offline' }, store, 4);
    A.flushHistory();
    const persisted = JSON.parse(store.getItem('urlEditorCheckHistory'));
    expect(Object.keys(persisted).sort()).toEqual(['keep', 'keepB']);
    expect(persisted.keep).toHaveLength(2);
    expect(persisted.keepB).toHaveLength(1);
  });

  test('known limitation: another tab pending records of a pruned id are written back', () => {
    const store = memoryStorage();
    const A = loadInstance();
    const B = loadInstance();
    A.recordCheck('gone', { status: 'online' }, store, 1);
    A.recordCheck('keep', { status: 'online' }, store, 2);
    A.flushHistory();
    B.recordCheck('gone', { status: 'offline' }, store, 3); // pending in B
    A.pruneHistory(['keep'], store);
    expect(idsOf(store)).toEqual(['keep']);
    B.flushHistory();
    // Orphan id until the next prune; never loses valid records.
    expect(idsOf(store).sort()).toEqual(['gone', 'keep']);
    A.pruneHistory(['keep'], store);
    expect(idsOf(store)).toEqual(['keep']);
  });

  test('prune drops pending records of pruned ids', () => {
    const store = memoryStorage();
    const A = loadInstance();
    A.recordCheck('gone', { status: 'online' }, store, 1);
    A.recordCheck('keep', { status: 'online' }, store, 2);
    A.pruneHistory(['keep'], store);
    A.flushHistory();
    expect(idsOf(store)).toEqual(['keep']);
    expect(A.getHistory('gone', store)).toEqual([]);
  });

  test('100 record+get calls still parse O(1) and write once', () => {
    const store = memoryStorage();
    const A = loadInstance();
    const setSpy = jest.spyOn(store, 'setItem');
    const parseSpy = jest.spyOn(JSON, 'parse');
    for (let i = 0; i < 100; i += 1) {
      A.recordCheck(`id${i % 20}`, { status: 'online' }, store, i);
      A.getHistory(`id${i % 20}`, store);
    }
    A.flushHistory();
    expect(parseSpy.mock.calls.length).toBeLessThanOrEqual(3);
    expect(setSpy).toHaveBeenCalledTimes(1);
    parseSpy.mockRestore();
  });
});

describe('checkHistory identical results', () => {
  test('identical results in the same millisecond are all kept', () => {
    const store = memoryStorage();
    for (let i = 0; i < 3; i += 1) {
      recordCheck('same', { status: 'online', code: 200 }, store, 5);
    }
    expect(getHistory('same', store)).toHaveLength(3);
    flushHistory();
    expect(getHistory('same', store)).toHaveLength(3);
    expect(
      JSON.parse(store.getItem('urlEditorCheckHistory')).same
    ).toHaveLength(3);
  });
});
