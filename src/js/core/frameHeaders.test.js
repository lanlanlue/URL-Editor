import { isEmbeddable } from './frameHeaders.js';

const headers = (map) => ({
  get: (name) => map[name.toLowerCase()] ?? null,
});

describe('isEmbeddable', () => {
  test('is embeddable when no relevant headers are present', () => {
    expect(isEmbeddable(headers({}))).toBe(true);
  });

  test('tolerates missing or malformed header objects', () => {
    expect(isEmbeddable(undefined)).toBe(true);
    expect(isEmbeddable(null)).toBe(true);
    expect(isEmbeddable({})).toBe(true);
  });

  test.each(['DENY', 'deny', 'SAMEORIGIN', 'sameorigin', 'DENY, SAMEORIGIN'])(
    'X-Frame-Options %s blocks embedding',
    (value) => {
      expect(isEmbeddable(headers({ 'x-frame-options': value }))).toBe(false);
    }
  );

  test('unrelated CSP without frame-ancestors does not block', () => {
    expect(
      isEmbeddable(
        headers({ 'content-security-policy': "default-src 'self'; img-src *" })
      )
    ).toBe(true);
  });

  test.each([
    ["frame-ancestors 'none'", false],
    ["frame-ancestors 'self'", false],
    ['frame-ancestors https://parent.example', false],
    ['frame-ancestors https://a.example https://b.example', false],
    ['frame-ancestors *', true],
    ["default-src 'self'; frame-ancestors *; img-src *", true],
    ["default-src 'self'; FRAME-ANCESTORS 'none'", false],
  ])('CSP %s -> embeddable %s', (csp, expected) => {
    expect(isEmbeddable(headers({ 'content-security-policy': csp }))).toBe(
      expected
    );
  });

  describe('multiple CSP headers combined by Fetch with ", "', () => {
    test("frame-ancestors 'none' in a later policy blocks embedding", () => {
      const csp = "default-src 'self', frame-ancestors 'none'";
      expect(isEmbeddable(headers({ 'content-security-policy': csp }))).toBe(
        false
      );
    });

    test('frame-ancestors in the first policy blocks embedding', () => {
      const csp = "frame-ancestors 'self', default-src 'self'";
      expect(isEmbeddable(headers({ 'content-security-policy': csp }))).toBe(
        false
      );
    });

    test('a permissive policy does not override a restrictive one', () => {
      const csp = "frame-ancestors *, frame-ancestors 'none'";
      expect(isEmbeddable(headers({ 'content-security-policy': csp }))).toBe(
        false
      );
    });

    test('all policies permissive keeps the page embeddable', () => {
      const csp = "default-src 'self', frame-ancestors *";
      expect(isEmbeddable(headers({ 'content-security-policy': csp }))).toBe(
        true
      );
    });

    test('works with a Headers object that appends two CSP headers', () => {
      const h = new Headers();
      h.append('Content-Security-Policy', "default-src 'self'");
      h.append('Content-Security-Policy', "frame-ancestors 'none'");
      expect(isEmbeddable(h)).toBe(false);
    });
  });

  test('a directive that merely starts with frame-ancestors is not matched', () => {
    expect(
      isEmbeddable(
        headers({ 'content-security-policy': 'frame-ancestors-extra foo' })
      )
    ).toBe(true);
  });

  test('X-Frame-Options still blocks even if CSP allows any ancestor', () => {
    expect(
      isEmbeddable(
        headers({
          'x-frame-options': 'DENY',
          'content-security-policy': 'frame-ancestors *',
        })
      )
    ).toBe(false);
  });
});
