import {
  validateUrl,
  parseUrl,
  extractDomainsFromUrls,
  replaceUrlDomain,
  replaceStringContent,
  batchProcessUrls,
  findDuplicateUrls,
  generateSuggestedLabel,
  generateSuggestedTags,
  parseBatchUrlText,
} from './urlParser';

describe('urlParser', () => {
  describe('validateUrl', () => {
    it('should return valid for a correct URL', () => {
      const result = validateUrl('https://example.com/path?foo=bar');
      expect(result.valid).toBe(true);
      expect(result.url).toBeInstanceOf(URL);
    });

    it('should return invalid for an incorrect URL', () => {
      const result = validateUrl('not a url');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('parseUrl', () => {
    it('should correctly parse a URL object', () => {
      const url = new URL('https://sub.example.com:8080/test/path?a=1&b=2');
      const parsed = parseUrl(url);
      expect(parsed.domain).toBe('sub.example.com');
      expect(parsed.path).toBe('/test/path');
      expect(parsed.params).toEqual([
        ['a', '1'],
        ['b', '2'],
      ]);
    });
  });

  describe('extractDomainsFromUrls', () => {
    it('should extract unique domains sorted by count', () => {
      const urls = [
        { url: 'https://api.dev.com/v1/users' },
        { url: 'https://api.dev.com/v1/orders' },
        { url: 'http://localhost:3000/app' },
        { url: 'https://test.qa.com/login' },
        { url: 'invalid-url' },
      ];

      const domains = extractDomainsFromUrls(urls);
      expect(domains).toEqual([
        { domain: 'api.dev.com', count: 2 },
        { domain: 'localhost:3000', count: 1 },
        { domain: 'test.qa.com', count: 1 },
      ]);
    });
  });

  describe('replaceUrlDomain', () => {
    it('should replace hostname while keeping protocol, path and params', () => {
      const res = replaceUrlDomain(
        'https://old-api.test.com/path/to/resource?id=123&type=a#heading',
        'old-api.test.com',
        'new-api.prod.com'
      );
      expect(res.changed).toBe(true);
      expect(res.newUrl).toBe(
        'https://new-api.prod.com/path/to/resource?id=123&type=a#heading'
      );
    });

    it('should replace domain with new origin including protocol and port', () => {
      const res = replaceUrlDomain(
        'http://localhost:3000/api/check',
        'localhost:3000',
        'https://qa-server.company.com:8443'
      );
      expect(res.changed).toBe(true);
      expect(res.newUrl).toBe('https://qa-server.company.com:8443/api/check');
    });

    it('should match full origin if oldDomain has protocol', () => {
      const res = replaceUrlDomain(
        'http://old.com/data',
        'http://old.com',
        'https://new.com'
      );
      expect(res.changed).toBe(true);
      expect(res.newUrl).toBe('https://new.com/data');
    });

    it('should not change URL if domain does not match', () => {
      const res = replaceUrlDomain(
        'https://another.com/data',
        'old.com',
        'new.com'
      );
      expect(res.changed).toBe(false);
      expect(res.newUrl).toBe('https://another.com/data');
    });
  });

  describe('replaceStringContent', () => {
    it('should replace text case-insensitively by default', () => {
      const res = replaceStringContent(
        'https://api.com/v1/USERS/1?v1=true',
        'v1',
        'v2'
      );
      expect(res.changed).toBe(true);
      expect(res.result).toBe('https://api.com/v2/USERS/1?v2=true');
    });

    it('should respect case sensitivity when matchCase is true', () => {
      const res = replaceStringContent(
        'https://api.com/v1/USERS/1',
        'USERS',
        'accounts',
        true
      );
      expect(res.changed).toBe(true);
      expect(res.result).toBe('https://api.com/v1/accounts/1');
    });
  });

  describe('batchProcessUrls', () => {
    it('should batch replace domains on matching URLs only', () => {
      const urls = [
        { id: '1', url: 'https://dev.com/1', label: 'Dev 1', tags: [] },
        { id: '2', url: 'https://dev.com/2', label: 'Dev 2', tags: [] },
        { id: '3', url: 'https://other.com/3', label: 'Other', tags: [] },
      ];

      const res = batchProcessUrls(urls, {
        type: 'domain',
        oldDomain: 'dev.com',
        newDomain: 'qa.com',
      });

      expect(res.affectedCount).toBe(2);
      expect(res.updatedUrls[0].url).toBe('https://qa.com/1');
      expect(res.updatedUrls[1].url).toBe('https://qa.com/2');
      expect(res.updatedUrls[2].url).toBe('https://other.com/3');
    });

    it('should respect filterIds when specified', () => {
      const urls = [
        { id: '1', url: 'https://dev.com/1', label: 'Dev 1', tags: [] },
        { id: '2', url: 'https://dev.com/2', label: 'Dev 2', tags: [] },
      ];

      const res = batchProcessUrls(urls, {
        type: 'domain',
        oldDomain: 'dev.com',
        newDomain: 'qa.com',
        filterIds: ['1'],
      });

      expect(res.affectedCount).toBe(1);
      expect(res.updatedUrls[0].url).toBe('https://qa.com/1');
      expect(res.updatedUrls[1].url).toBe('https://dev.com/2');
    });
  });

  describe('findDuplicateUrls', () => {
    it('should detect duplicate URLs and return counts and ids', () => {
      const urls = [
        { id: '1', url: 'https://example.com/api' },
        { id: '2', url: 'https://example.com/api' },
        { id: '3', url: 'https://example.com/other' },
      ];

      const res = findDuplicateUrls(urls);
      expect(res.totalDuplicates).toBe(1);
      expect(res.duplicates).toEqual([
        {
          url: 'https://example.com/api',
          count: 2,
          ids: ['1', '2'],
        },
      ]);
    });
  });

  describe('generateSuggestedLabel', () => {
    it('should use explicitName if provided', () => {
      const label = generateSuggestedLabel(
        'https://example.com/test',
        'Custom Name'
      );
      expect(label).toBe('Custom Name');
    });

    it('should extract name from URL query parameter', () => {
      const label = generateSuggestedLabel(
        'https://example.com/search?title=My%20Dashboard'
      );
      expect(label).toBe('My Dashboard');
    });

    it('should format path segments into readable label', () => {
      const label = generateSuggestedLabel(
        'https://api.dev.com/v1/user-profiles'
      );
      expect(label).toBe('user profiles');
    });

    it('should fallback to hostname for root URLs', () => {
      const label = generateSuggestedLabel('https://google.com/');
      expect(label).toBe('google.com');
    });
  });

  describe('generateSuggestedTags', () => {
    it('should detect environment, domain, and API tags', () => {
      const tags = generateSuggestedTags(
        'https://api.dev.github.com/v1/auth/login'
      );
      expect(tags).toContain('dev');
      expect(tags).toContain('github');
      expect(tags).toContain('api');
      expect(tags).toContain('v1');
      expect(tags).toContain('auth');
      expect(tags).toContain('login');
    });

    it('should detect localhost and port environment', () => {
      const tags = generateSuggestedTags('http://localhost:3000/dashboard');
      expect(tags).toContain('localhost');
      expect(tags).toContain('dashboard');
    });
  });

  describe('parseBatchUrlText', () => {
    it('should parse multi-line text and Markdown links with suggestions', () => {
      const text = `
        https://api.dev.example.com/v1/users?id=10
        - [Order System](https://qa.example.com/orders)
        Some article mentioning http://localhost:8080/admin/settings in text
      `;

      const res = parseBatchUrlText(text, {
        autoName: true,
        autoTag: true,
        commonTags: ['imported'],
        existingUrls: [{ url: 'https://qa.example.com/orders' }],
      });

      expect(res.stats.totalFound).toBe(3);
      expect(res.stats.uniqueFound).toBe(3);
      expect(res.stats.existingCount).toBe(1);

      const items = res.items;
      expect(items[0].url).toBe('https://api.dev.example.com/v1/users?id=10');
      expect(items[0].tags).toContain('dev');
      expect(items[0].tags).toContain('imported');

      expect(items[1].url).toBe('https://qa.example.com/orders');
      expect(items[1].label).toBe('Order System');
      expect(items[1].isExisting).toBe(true);
      expect(items[1].selected).toBe(false); // Unselected by default for existing items

      expect(items[2].url).toBe('http://localhost:8080/admin/settings');
      expect(items[2].tags).toContain('localhost');
      expect(items[2].tags).toContain('admin');
    });
  });
});
