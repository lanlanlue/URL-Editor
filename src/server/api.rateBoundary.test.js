import { handleApiRequest, apiInternals } from './api';

const auth = (env = {}, headers = {}) =>
  handleApiRequest(
    new Request('https://url-editor.ointw.com/api/auth/google', {
      method: 'POST',
      headers: { Origin: 'https://url-editor.ointw.com', ...headers },
      body: '{}',
    }),
    env
  );

describe('rate limit trust and platform boundary', () => {
  test('rotating untrusted XFF cannot reset the unknown-client bucket', async () => {
    let last;
    for (let i = 0; i < 11; i++)
      last = await auth({}, { 'X-Forwarded-For': `spoof-${i}` });
    expect(last.status).toBe(429);
  });
  test('optional platform binding denies before OAuth network or DB access', async () => {
    const binding = { limit: jest.fn().mockResolvedValue({ success: false }) };
    const response = await auth(
      { AUTH_RATE_LIMITER: binding },
      { 'CF-Connecting-IP': 'binding-deny' }
    );
    expect(response.status).toBe(429);
    expect(binding.limit).toHaveBeenCalledWith({ key: 'auth:binding-deny' });
  });
  test('binding errors fail closed rather than silently using the isolate Map', async () => {
    const binding = {
      limit: jest.fn().mockRejectedValue(new Error('unavailable')),
    };
    const response = await auth(
      { AUTH_RATE_LIMITER: binding },
      { 'CF-Connecting-IP': 'binding-error' }
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('RATE_LIMIT_UNAVAILABLE');
  });
  test('binding allow still applies local per-route guard', async () => {
    const binding = { limit: jest.fn().mockResolvedValue({ success: true }) };
    expect(
      (
        await auth(
          { AUTH_RATE_LIMITER: binding },
          { 'CF-Connecting-IP': 'binding-allow' }
        )
      ).status
    ).toBe(422);
  });
  test('mixed window buckets retain their own expiration and capacity is bounded', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000);
    const buckets = new Map();
    expect(apiInternals.rateLimit('long', 1, 3600000, buckets)).toBe(true);
    jest.spyOn(Date, 'now').mockReturnValue(62000);
    for (let i = 0; i < 5000; i++)
      apiInternals.rateLimit(`short-${i}`, 1, 60000, buckets);
    expect(buckets.size).toBeLessThanOrEqual(5000);
    expect(apiInternals.rateLimit('long', 1, 3600000, buckets)).toBe(false);
    jest.restoreAllMocks();
  });
});

describe('bounded opportunistic expired session cleanup', () => {
  test('cleanup deletes only expired rows with bounded SQL and throttles per DB', async () => {
    const run = jest.fn().mockResolvedValue({ meta: { changes: 2 } });
    const bind = jest.fn(() => ({ run }));
    const DB = { prepare: jest.fn(() => ({ bind })) };
    await handleApiRequest(
      new Request('https://url-editor.ointw.com/api/config'),
      { DB }
    );
    expect(DB.prepare).toHaveBeenCalledWith(
      expect.stringMatching(
        /DELETE FROM sessions WHERE token_hash IN \(SELECT token_hash FROM sessions WHERE expires_at <= \? ORDER BY expires_at LIMIT 100\)/
      )
    );
    expect(bind).toHaveBeenCalledWith(expect.any(Number));
    await handleApiRequest(
      new Request('https://url-editor.ointw.com/api/config'),
      { DB }
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
  test('failed cleanup is best effort and cannot block a normal response', async () => {
    const run = jest.fn().mockRejectedValue(new Error('busy'));
    const DB = { prepare: () => ({ bind: () => ({ run }) }) };
    expect(
      (
        await handleApiRequest(
          new Request('https://url-editor.ointw.com/api/config'),
          { DB }
        )
      ).status
    ).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
