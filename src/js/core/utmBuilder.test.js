import { buildUtmUrl, validateUtmParams } from './utmBuilder';

describe('utmBuilder', () => {
  test('normalizes UTM values and preserves unrelated query parameters', () => {
    expect(
      buildUtmUrl('https://example.com/landing?user_id=123', {
        utm_source: 'Google Ads',
        utm_medium: 'CPC',
        utm_campaign: 'Summer Sale',
      })
    ).toBe(
      'https://example.com/landing?user_id=123&utm_source=google+ads&utm_medium=cpc&utm_campaign=summer+sale'
    );
  });

  test('reports required values and invalid control characters', () => {
    const result = validateUtmParams({ utm_source: 'google\nads' });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('utm_medium is required');
    expect(result.errors.join(' ')).toContain('control characters');
  });
});
