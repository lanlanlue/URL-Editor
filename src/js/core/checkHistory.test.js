import {
  HISTORY_LIMIT,
  buildResultsCsv,
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
