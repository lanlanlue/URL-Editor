import { validateUrl, parseUrl } from './urlParser';

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
});
