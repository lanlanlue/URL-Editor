import worker, { workerInternals } from './worker.js';

describe('Workers entry point', () => {
  test('recognizes both the API root and nested API routes', () => {
    expect(workerInternals.isApiRequest('/api')).toBe(true);
    expect(workerInternals.isApiRequest('/api/session')).toBe(true);
    expect(workerInternals.isApiRequest('/apiary')).toBe(false);
  });

  test('serves the app shell through the asset binding with its query string', async () => {
    const fetchAsset = jest.fn(
      async () =>
        new Response('<!doctype html>', {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
    );

    const response = await worker.fetch(
      new Request('https://url-editor.ointw.com/app?tab=recent'),
      { ASSETS: { fetch: fetchAsset } }
    );

    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(fetchAsset.mock.calls[0][0].url).toBe(
      'https://url-editor.ointw.com/index.html?tab=recent'
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com"
    );
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });

  test('serves the login shell with the Google-only CSP', async () => {
    const fetchAsset = jest.fn(async () => new Response('<!doctype html>'));

    const response = await worker.fetch(
      new Request('https://url-editor.ointw.com/login'),
      { ASSETS: { fetch: fetchAsset } }
    );

    expect(fetchAsset.mock.calls[0][0].url).toBe(
      'https://url-editor.ointw.com/login.html'
    );
    expect(response.headers.get('Content-Security-Policy')).toContain(
      'https://accounts.google.com/gsi/client'
    );
  });
});
