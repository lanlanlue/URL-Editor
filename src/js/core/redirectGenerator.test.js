import { generateRedirectRule } from './redirectGenerator';

describe('redirectGenerator', () => {
  test('generates an Nginx rule and preserves the query string', () => {
    const rule = generateRedirectRule(
      '/old-path',
      'https://domain.com/new-path',
      'nginx'
    );
    expect(rule).toContain('rewrite ^/old-path$');
    expect(rule).toContain('https://domain.com/new-path');
    expect(rule).toContain('query string is preserved');
  });

  test('converts wildcards for Apache and Vercel', () => {
    expect(
      generateRedirectRule('/old/*', 'https://domain.com/new/*', 'apache')
    ).toContain('https://domain.com/new/$1');

    const vercelRule = JSON.parse(
      generateRedirectRule('/old/*', 'https://domain.com/new/*', 'vercel')
    );
    expect(vercelRule.source).toBe('/old/:splat*');
    expect(vercelRule.destination).toBe('https://domain.com/new/:splat*');
    expect(vercelRule.permanent).toBe(true);
  });

  test('generates Cloudflare Workers code', () => {
    const rule = generateRedirectRule(
      '/old-path',
      'https://domain.com/new-path',
      'cloudflare'
    );
    expect(rule).toContain("url.pathname === '/old-path'");
    expect(rule).toContain('Response.redirect');
  });
});
