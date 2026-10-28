import {
  applyAssertions,
  evaluateAssertions,
  matchesStatus,
  normalizeAssertions,
} from './assertions';

describe('normalizeAssertions', () => {
  test('returns null when nothing is configured or input is junk', () => {
    expect(normalizeAssertions(null)).toBeNull();
    expect(normalizeAssertions('x')).toBeNull();
    expect(
      normalizeAssertions({ expectedStatus: ' ', keyword: '', maxTimeMs: 0 })
    ).toBeNull();
  });

  test('cleans values', () => {
    expect(
      normalizeAssertions({
        expectedStatus: ' 200, 301 ',
        keyword: 'ok',
        maxTimeMs: '1500.4',
      })
    ).toEqual({ expectedStatus: '200,301', keyword: 'ok', maxTimeMs: 1500 });
  });
});

describe('matchesStatus', () => {
  test.each([
    [200, '200', true],
    [201, '200', false],
    [204, '2xx', true],
    [301, '2xx', false],
    [301, '200,301', true],
    [250, '200-299', true],
    [300, '200-299', false],
    [404, '4XX', true],
    [200, 'abc', false],
  ])('%s vs %s -> %s', (code, spec, expected) => {
    expect(matchesStatus(code, spec)).toBe(expected);
  });
});

describe('evaluateAssertions / applyAssertions', () => {
  const ok = { status: 'online', code: 200, timeMs: 300, mode: 'extension' };

  test('no assertions: result is returned untouched', () => {
    expect(applyAssertions(ok, null)).toBe(ok);
  });

  test('all pass', () => {
    const out = applyAssertions(
      { ...ok, keywordFound: true },
      { expectedStatus: '2xx', keyword: 'hi', maxTimeMs: 1000 }
    );
    expect(out.status).toBe('online');
    expect(out.assertion).toEqual({
      passed: true,
      state: 'passed',
      failures: [],
      skipped: [],
    });
  });

  test('wrong status fails and explains why', () => {
    const out = applyAssertions(ok, { expectedStatus: '301' });
    expect(out.status).toBe('offline');
    expect(out.error).toBe('Expected status 301, got 200');
  });

  test('an expected 404 counts as passing', () => {
    const out = applyAssertions(
      { status: 'offline', code: 404, error: 'HTTP 404', mode: 'server' },
      { expectedStatus: '404' }
    );
    expect(out.status).toBe('online');
    expect(out.error).toBeUndefined();
  });

  test('slow response fails the time budget', () => {
    const out = applyAssertions(ok, { maxTimeMs: 100 });
    expect(out.status).toBe('offline');
    expect(out.assertion.failures[0]).toMatchObject({
      type: 'time',
      actual: 300,
    });
  });

  test('missing keyword fails', () => {
    const out = applyAssertions(
      { ...ok, keywordFound: false },
      { keyword: 'Welcome' }
    );
    expect(out.status).toBe('offline');
    expect(out.error).toContain('Welcome');
  });

  test('status and keyword are skipped, not passed, in limited mode', () => {
    const limited = { status: 'online', timeMs: 50, mode: 'limited' };
    const out = applyAssertions(limited, {
      expectedStatus: '200',
      keyword: 'x',
      maxTimeMs: 100,
    });
    expect(out.assertion.skipped).toEqual(['status', 'keyword']);
    expect(out.assertion.passed).toBe(true);
    expect(out.status).toBe('online');
  });

  test('an unreachable host fails a status assertion', () => {
    const out = applyAssertions(
      { status: 'offline', error: 'Timeout', mode: 'extension' },
      { expectedStatus: '200' }
    );
    expect(out.status).toBe('offline');
    expect(
      evaluateAssertions(out, { expectedStatus: '200' }).failures[0].actual
    ).toBe('no response');
  });

  test('when every configured check is skipped the result is skipped, not passed', () => {
    const limited = { status: 'online', mode: 'limited' };
    const out = applyAssertions(limited, {
      expectedStatus: '200',
      keyword: 'x',
    });
    expect(out.assertion.skipped).toEqual(['status', 'keyword']);
    expect(out.assertion.failures).toEqual([]);
    expect(out.assertion.passed).toBe(false);
    expect(out.assertion.state).toBe('skipped');
    // A skipped assertion neither fails nor overrides the health status.
    expect(out.status).toBe('online');
    expect(out.error).toBeUndefined();
  });

  test('state is passed or failed when at least one check was evaluated', () => {
    const limited = { status: 'online', timeMs: 50, mode: 'limited' };
    expect(
      evaluateAssertions(limited, {
        expectedStatus: '200',
        keyword: '',
        maxTimeMs: 100,
      }).state
    ).toBe('passed');
    expect(
      evaluateAssertions(limited, {
        expectedStatus: '',
        keyword: '',
        maxTimeMs: 10,
      }).state
    ).toBe('failed');
  });
});
