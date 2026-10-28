import defaultExport, {
  REDIRECT_FORMATS,
  generateAllRedirectRules,
  generateRedirect,
  generateRedirectRule,
  generateRedirectRules,
} from './redirectGenerator';

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

describe('redirectGenerator formats and edge cases', () => {
  const NOTE = ' # original query string is preserved';

  test('nginx: exact rule escapes regex metacharacters and honours preserveQuery=false', () => {
    expect(
      generateRedirectRule('/a.b+c', '/new', 'nginx', { preserveQuery: false })
    ).toBe('rewrite ^/a\\.b\\+c$ /new permanent;');
  });

  test('nginx: wildcard rewrites to a capture group, with prefix and suffix', () => {
    expect(generateRedirectRule('/old/*', '/new/*', 'nginx')).toBe(
      `rewrite ^/old/(.*)$ /new/$1 permanent;${NOTE}`
    );
    expect(
      generateRedirectRule('/old/*/index.html', '/new/*', 'nginx', {
        preserveQuery: false,
      })
    ).toBe('rewrite ^/old/(.*)/index\\.html$ /new/$1 permanent;');
  });

  test('apache: exact uses Redirect, wildcard uses RedirectMatch', () => {
    expect(
      generateRedirectRule('/a', '/b', 'apache', { preserveQuery: false })
    ).toBe('Redirect 301 /a /b');
    expect(generateRedirectRule('/a', '/b', 'apache')).toBe(
      `Redirect 301 /a /b${NOTE}`
    );
    expect(generateRedirectRule('/a/*', '/b/*', 'apache')).toBe(
      `RedirectMatch 301 ^/a/(.*)$ /b/$1${NOTE}`
    );
  });

  test('cloudflare: simple exact rule is a one-liner', () => {
    expect(
      generateRedirectRule('/a', 'https://x.test/b', 'cloudflare', {
        preserveQuery: false,
      })
    ).toBe(
      "if (url.pathname === '/a') { return Response.redirect('https://x.test/b', 301); }"
    );
  });

  test('cloudflare: preserveQuery copies the search string; wildcard uses startsWith', () => {
    const exact = generateRedirectRule('/a', '/b', 'cloudflare');
    expect(exact).toContain("url.pathname === '/a'");
    expect(exact).toContain('target.search = url.search;');
    const wild = generateRedirectRule('/a/*', '/b/*', 'cloudflare', {
      preserveQuery: false,
    });
    expect(wild).toContain("url.pathname.startsWith('/a/')");
    expect(wild).not.toContain('target.search');
    expect(wild).toContain("new URL('/b/$1', url)");
  });

  test('cloudflare: single quotes and backslashes in paths are escaped', () => {
    const rule = generateRedirectRule("/it's", '/c\\d', 'cloudflare', {
      preserveQuery: false,
    });
    expect(rule).toContain("'/it\\'s'");
    expect(rule).toContain("'/c\\\\d'");
  });

  test('vercel: exact and wildcard rules as JSON', () => {
    expect(JSON.parse(generateRedirectRule('/a', '/b', 'vercel'))).toEqual({
      source: '/a',
      destination: '/b',
      permanent: true,
    });
    expect(
      JSON.parse(generateRedirectRule('/a/*/z', '/b/*', 'vercel.json'))
    ).toEqual({
      source: '/a/:splat*/z',
      destination: '/b/:splat*',
      permanent: true,
    });
  });

  test('format aliases and case-insensitivity', () => {
    expect(generateRedirectRule('/a', '/b', 'NGINX')).toBe(
      generateRedirectRule('/a', '/b', 'nginx')
    );
    expect(generateRedirectRule('/a', '/b', 'cloudflare-workers')).toBe(
      generateRedirectRule('/a', '/b', 'cloudflare')
    );
  });

  test('defaults to nginx when the format is omitted', () => {
    expect(generateRedirectRule('/a', '/b')).toMatch(/^rewrite /);
  });

  test('throws RangeError on an unsupported format', () => {
    expect(() => generateRedirectRule('/a', '/b', 'iis')).toThrow(RangeError);
    expect(() => generateRedirectRule('/a', '/b', 'iis')).toThrow(
      /Unsupported redirect format: iis/
    );
  });

  test('throws TypeError for empty source or destination', () => {
    expect(() => generateRedirectRule('', '/b')).toThrow('source is required');
    expect(() => generateRedirectRule('   ', '/b')).toThrow(
      'source is required'
    );
    expect(() => generateRedirectRule(undefined, '/b')).toThrow(TypeError);
    expect(() => generateRedirectRule('/a', '')).toThrow(
      'destination is required'
    );
    expect(() => generateRedirectRule('/a', null)).toThrow(TypeError);
  });

  test('normalises sources: missing slash, fragment, and absolute URLs', () => {
    expect(
      generateRedirectRule('a', '/b', 'apache', { preserveQuery: false })
    ).toBe('Redirect 301 /a /b');
    expect(
      generateRedirectRule('/a#frag', '/b', 'apache', { preserveQuery: false })
    ).toBe('Redirect 301 /a /b');
    expect(
      generateRedirectRule('https://old.test/p/q?x=1', '/b', 'apache', {
        preserveQuery: false,
      })
    ).toBe('Redirect 301 /p/q?x=1 /b');
    expect(
      generateRedirectRule('https://old.test', '/b', 'apache', {
        preserveQuery: false,
      })
    ).toBe('Redirect 301 / /b');
  });

  test('normalises destinations: relative gets a slash, absolute is kept', () => {
    expect(
      generateRedirectRule('/a', 'b', 'apache', { preserveQuery: false })
    ).toBe('Redirect 301 /a /b');
    expect(
      generateRedirectRule('/a', ' ftp://h.test/x ', 'apache', {
        preserveQuery: false,
      })
    ).toBe('Redirect 301 /a ftp://h.test/x');
  });

  test('object form accepts source/oldUrl/from, destination/newUrl/to and options', () => {
    const expected = 'Redirect 301 /a /b';
    const opts = { preserveQuery: false };
    expect(
      generateRedirectRule({
        source: '/a',
        destination: '/b',
        format: 'apache',
        options: opts,
      })
    ).toBe(expected);
    expect(
      generateRedirectRule({
        oldUrl: '/a',
        newUrl: '/b',
        format: 'apache',
        options: opts,
      })
    ).toBe(expected);
    expect(
      generateRedirectRule({
        from: '/a',
        to: '/b',
        format: 'apache',
        options: opts,
      })
    ).toBe(expected);
    expect(generateRedirectRule({ from: '/a', to: '/b' })).toMatch(
      /^rewrite \^\/a\$ \/b permanent;/
    );
  });

  test('preserveQuery only disabled by an explicit false', () => {
    expect(
      generateRedirectRule('/a', '/b', 'apache', { preserveQuery: undefined })
    ).toContain('preserved');
    expect(
      generateRedirectRule('/a', '/b', 'apache', { preserveQuery: 0 })
    ).toContain('preserved');
  });

  test('aliases are the same functions', () => {
    expect(generateRedirect).toBe(generateRedirectRule);
    expect(generateAllRedirectRules).toBe(generateRedirectRules);
    expect(defaultExport).toBe(generateRedirectRule);
  });

  test('REDIRECT_FORMATS is frozen with the four formats', () => {
    expect(Object.isFrozen(REDIRECT_FORMATS)).toBe(true);
    expect(Object.values(REDIRECT_FORMATS)).toEqual([
      'nginx',
      'apache',
      'cloudflare',
      'vercel',
    ]);
  });

  describe('generateRedirectRules', () => {
    test('returns every format keyed by name', () => {
      const rules = generateRedirectRules('/a', '/b', { preserveQuery: false });
      expect(Object.keys(rules)).toEqual([
        'nginx',
        'apache',
        'cloudflare',
        'vercel',
      ]);
      expect(rules.apache).toBe('Redirect 301 /a /b');
      expect(JSON.parse(rules.vercel).source).toBe('/a');
    });

    test('object source without format returns all formats using its options', () => {
      const rules = generateRedirectRules({
        oldUrl: '/a',
        newUrl: '/b',
        options: { preserveQuery: false },
      });
      expect(rules.apache).toBe('Redirect 301 /a /b');
      expect(rules.nginx).toBe('rewrite ^/a$ /b permanent;');
    });

    test('object source falls back to the options argument', () => {
      const rules = generateRedirectRules({ from: '/a', to: '/b' }, undefined, {
        preserveQuery: false,
      });
      expect(rules.apache).toBe('Redirect 301 /a /b');
    });

    test('object source with a format returns a single rule string', () => {
      expect(
        generateRedirectRules({
          source: '/a',
          destination: '/b',
          format: 'apache',
          options: { preserveQuery: false },
        })
      ).toBe('Redirect 301 /a /b');
    });

    test('propagates validation errors', () => {
      expect(() => generateRedirectRules('', '/b')).toThrow(
        'source is required'
      );
    });
  });
});
