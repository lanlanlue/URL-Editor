import { PROBE_LIMITS, runProbe, validateProbeTarget } from './probe.js';

const res = (status, { headers = {}, body = '' } = {}) => ({
  status,
  headers: new Headers(headers),
  body: null,
  text: async () => body,
});

describe('validateProbeTarget', () => {
  test.each([
    'https://example.com/path?x=1',
    'http://example.com:8080/',
    'https://sub.example.co.uk',
    'https://93.184.216.34/',
    'https://[2606:4700::1111]/',
  ])('allows %s', (url) => {
    expect(validateProbeTarget(url).ok).toBe(true);
  });

  test.each([
    ['ftp://example.com', 'scheme'],
    ['file:///etc/passwd', 'scheme'],
    ['javascript:alert(1)', 'scheme'],
    ['https://user:pw@example.com', 'credentials'],
    ['https://example.com:22', 'port'],
    ['https://example.com:6379', 'port'],
    ['http://localhost/', 'name'],
    ['http://foo.localhost/', 'name'],
    ['http://intranet/', 'single label'],
    ['http://printer.local/', 'mdns'],
    ['http://db.internal/', 'internal'],
    ['http://127.0.0.1/', 'loopback'],
    ['http://2130706433/', 'decimal loopback'],
    ['http://0x7f.1/', 'hex loopback'],
    ['http://10.0.0.5/', 'rfc1918'],
    ['http://172.16.4.4/', 'rfc1918'],
    ['http://172.32.0.1/', null],
    ['http://192.168.1.1/', 'rfc1918'],
    ['http://169.254.169.254/latest/meta-data', 'metadata'],
    ['http://100.64.0.1/', 'cgnat'],
    ['http://0.0.0.0/', 'unspecified'],
    ['http://224.0.0.1/', 'multicast'],
    ['http://[::1]/', 'ipv6 loopback'],
    ['http://[fd00::1]/', 'ipv6 ula'],
    ['http://[fe80::1]/', 'ipv6 link-local'],
    ['http://[::ffff:127.0.0.1]/', 'ipv4-mapped'],
    ['', 'empty'],
    ['not a url', 'garbage'],
  ])('blocks %s (%s)', (url, label) => {
    // 172.32.0.1 is public and must NOT be blocked.
    expect(validateProbeTarget(url).ok).toBe(label === null);
  });

  test('rejects over-long URLs', () => {
    expect(
      validateProbeTarget('https://example.com/' + 'a'.repeat(3000)).ok
    ).toBe(false);
  });
});

describe('runProbe', () => {
  test('returns blocked for a private initial URL and never fetches', async () => {
    const fetchImpl = jest.fn();
    const out = await runProbe('http://10.0.0.1/', {}, fetchImpl);
    expect(out.blocked).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('reports status, title, embeddability and timing', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      res(200, {
        headers: { 'x-frame-options': 'DENY', 'content-type': 'text/html' },
        body: '<html><title>  Hello \n World </title></html>',
      })
    );
    const out = await runProbe('https://example.com/', {}, fetchImpl);
    expect(out).toMatchObject({
      reachable: true,
      code: 200,
      finalUrl: 'https://example.com/',
      redirects: [],
      embeddable: false,
      title: 'Hello World',
    });
    expect(out.keywordFound).toBeUndefined();
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      redirect: 'manual',
    });
    // No cookies or caller credentials are forwarded.
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBeUndefined();
  });

  test('keyword is matched case-sensitively in the body', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementation(async () => res(200, { body: 'Welcome back' }));
    expect(
      (await runProbe('https://e.com', { keyword: 'Welcome' }, fetchImpl))
        .keywordFound
    ).toBe(true);
    expect(
      (await runProbe('https://e.com', { keyword: 'welcome' }, fetchImpl))
        .keywordFound
    ).toBe(false);
  });

  test('follows redirects manually and records the first-hop status', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(res(301, { headers: { location: '/new' } }))
      .mockResolvedValueOnce(res(200, { body: 'ok' }));
    const out = await runProbe('https://e.com/old', {}, fetchImpl);
    expect(out.code).toBe(200);
    expect(out.finalUrl).toBe('https://e.com/new');
    expect(out.redirects).toEqual([{ url: 'https://e.com/old', status: 301 }]);
  });

  test('refuses a redirect into a private address', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        res(302, { headers: { location: 'http://169.254.169.254/latest' } })
      );
    const out = await runProbe('https://e.com/', {}, fetchImpl);
    expect(out).toMatchObject({
      reachable: false,
      error: 'Redirected to a blocked address',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('stops after too many redirects', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementation(async () =>
        res(302, { headers: { location: 'https://e.com/loop' } })
      );
    const out = await runProbe('https://e.com/', {}, fetchImpl);
    expect(out).toMatchObject({
      reachable: false,
      error: 'Too many redirects',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(PROBE_LIMITS.maxRedirects + 1);
  });

  test('network failure is reported without leaking internals', async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValue(new TypeError('connect ECONNREFUSED 1.2.3.4:443'));
    const out = await runProbe('https://e.com/', {}, fetchImpl);
    expect(out).toMatchObject({ reachable: false, error: 'Connection failed' });
    expect(JSON.stringify(out)).not.toContain('ECONNREFUSED');
  });

  test('abort is reported as Timeout', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    const out = await runProbe(
      'https://e.com/',
      {},
      jest.fn().mockRejectedValue(err)
    );
    expect(out.error).toBe('Timeout');
  });

  test('HTTP error codes are returned as reachable responses', async () => {
    const out = await runProbe(
      'https://e.com/',
      {},
      jest.fn().mockResolvedValue(res(503))
    );
    expect(out).toMatchObject({ reachable: true, code: 503 });
  });
});
