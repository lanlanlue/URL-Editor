import { batchStrip, stripTrackers } from './trackerStripper';

describe('trackerStripper', () => {
  test('removes known trackers but keeps business parameters and hash', () => {
    expect(
      stripTrackers(
        'https://example.com/page?user_id=123&utm_source=newsletter&fbclid=abc#section'
      )
    ).toBe('https://example.com/page?user_id=123#section');
  });

  test('supports batch arrays and leaves invalid input unchanged', () => {
    expect(batchStrip(['https://example.com?gclid=x', 'not a url'])).toEqual([
      'https://example.com/',
      'not a url',
    ]);
  });
});
