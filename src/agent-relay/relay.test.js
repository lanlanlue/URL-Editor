/**
 * @jest-environment node
 */
const { createRelay } = require('./relay.cjs');

const TOKEN = 'test-token-0123456789';
const ORIGIN = 'https://app.example';

async function boot(options = {}) {
  const relay = createRelay({
    token: TOKEN,
    allowedOrigins: [ORIGIN],
    pollTimeoutMs: 300,
    callTimeoutMs: 400,
    ...options,
  });
  const { port } = await relay.start();
  const url = (path) => `http://127.0.0.1:${port}${path}`;
  const authed = (extra = {}) => ({
    headers: { Authorization: `Bearer ${TOKEN}`, ...extra },
  });
  return { relay, port, url, authed };
}

describe('relay access control', () => {
  let ctx;
  afterEach(async () => ctx?.relay.stop());

  test('requires a token of reasonable length', () => {
    expect(() => createRelay({ token: 'short' })).toThrow();
  });

  test('rejects missing or wrong bearer tokens', async () => {
    ctx = await boot();
    expect((await fetch(ctx.url('/poll'))).status).toBe(401);
    const wrong = await fetch(ctx.url('/poll'), {
      headers: { Authorization: 'Bearer nope-nope-nope-nope' },
    });
    expect(wrong.status).toBe(401);
  });

  test('rejects origins that are not allow-listed', async () => {
    ctx = await boot();
    const response = await fetch(ctx.url('/poll'), {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: 'https://evil.test',
      },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('rejects a non-loopback Host header (DNS rebinding)', async () => {
    ctx = await boot();
    const status = await new Promise((resolve, reject) => {
      const request = require('http').request(
        {
          host: '127.0.0.1',
          port: ctx.port,
          path: '/poll',
          headers: { Host: 'attacker.test', Authorization: `Bearer ${TOKEN}` },
        },
        (response) => resolve(response.statusCode)
      );
      request.on('error', reject);
      request.end();
    });
    expect(status).toBe(403);
  });

  test('answers preflight for an allowed origin incl. private network', async () => {
    ctx = await boot();
    const response = await fetch(ctx.url('/poll'), {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(response.headers.get('access-control-allow-private-network')).toBe(
      'true'
    );
  });

  test('unknown paths are 404 once authenticated', async () => {
    ctx = await boot();
    expect((await fetch(ctx.url('/x'), ctx.authed())).status).toBe(404);
  });
});

describe('relay call flow', () => {
  let ctx;
  afterEach(async () => ctx?.relay.stop());

  test('reports no_client before any page has polled', async () => {
    ctx = await boot();
    const result = await ctx.relay.call('list', {});
    expect(result.error.code).toBe('no_client');
  });

  test('refuses methods outside the allow-list without queueing', async () => {
    ctx = await boot();
    const result = await ctx.relay.call('eval', { code: '1' });
    expect(result.error.code).toBe('unknown_method');
  });

  test('delivers a call to a polling page and returns its result', async () => {
    ctx = await boot();
    const poll = fetch(ctx.url('/poll'), ctx.authed());
    await new Promise((r) => setTimeout(r, 30));
    expect(ctx.relay.isConnected()).toBe(true);

    const pendingCall = ctx.relay.call('list', { query: 'a' });
    const job = await (await poll).json();
    expect(job).toMatchObject({ method: 'list', params: { query: 'a' } });

    const posted = await fetch(
      ctx.url('/result'),
      ctx.authed({ 'Content-Type': 'application/json' }) && {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: job.id, result: { ok: true, total: 1 } }),
      }
    );
    expect(posted.status).toBe(200);
    await expect(pendingCall).resolves.toEqual({ ok: true, total: 1 });
  });

  test('a queued call is delivered to the next poll', async () => {
    ctx = await boot();
    const first = await fetch(ctx.url('/poll'), ctx.authed()); // 204 after timeout
    expect(first.status).toBe(204);
    const pendingCall = ctx.relay.call('describe');
    const job = await (await fetch(ctx.url('/poll'), ctx.authed())).json();
    expect(job.method).toBe('describe');
    await fetch(ctx.url('/result'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: job.id, result: { ok: true } }),
    });
    await expect(pendingCall).resolves.toEqual({ ok: true });
  });

  test('times out when the page never answers', async () => {
    ctx = await boot();
    const poll = fetch(ctx.url('/poll'), ctx.authed());
    await new Promise((r) => setTimeout(r, 30));
    const result = await ctx.relay.call('list');
    await poll;
    expect(result.error.code).toBe('timeout');
  });

  test('result endpoint validates body and id', async () => {
    ctx = await boot();
    const post = (body) =>
      fetch(ctx.url('/result'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}` },
        body,
      });
    expect((await post('not json')).status).toBe(400);
    expect((await post(JSON.stringify({ id: 'zzz', result: {} }))).status).toBe(
      404
    );
    const huge = JSON.stringify({
      id: 'r1',
      result: 'x'.repeat(1024 * 1024 + 10),
    });
    const status = await post(huge).then(
      (r) => r.status,
      () => 'closed'
    );
    expect([413, 'closed']).toContain(status);
  });

  test('a newer poll supersedes the older one', async () => {
    ctx = await boot({ pollTimeoutMs: 5000 });
    const older = fetch(ctx.url('/poll'), ctx.authed());
    await new Promise((r) => setTimeout(r, 30));
    const newer = fetch(ctx.url('/poll'), ctx.authed());
    expect((await older).status).toBe(204);
    const pendingCall = ctx.relay.call('undo');
    const job = await (await newer).json();
    expect(job.method).toBe('undo');
    await fetch(ctx.url('/result'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: job.id, result: { ok: true } }),
    });
    await pendingCall;
  });

  test('stop resolves in-flight calls', async () => {
    ctx = await boot({ callTimeoutMs: 5000 });
    const poll = fetch(ctx.url('/poll'), ctx.authed());
    await new Promise((r) => setTimeout(r, 30));
    const pendingCall = ctx.relay.call('list');
    await poll;
    await ctx.relay.stop();
    expect((await pendingCall).error.code).toBe('shutdown');
  });
});
