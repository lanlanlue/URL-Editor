import defaultStrip, {
  DEFAULT_TRACKER_PARAMS,
  batchStrip,
  stripTrackers,
  stripTrackersDetailed,
} from './trackerStripper';

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

describe('trackerStripper edge cases', () => {
  test('empty, whitespace and non-string input', () => {
    expect(stripTrackers('')).toBe('');
    expect(stripTrackers('   ')).toBe('   ');
    expect(stripTrackers(undefined)).toBe('');
    expect(stripTrackers(null)).toBe('');
    expect(stripTrackers(123)).toBe(123);
  });

  test('returns unparseable strings unchanged', () => {
    expect(stripTrackers('not a url?utm_source=x')).toBe(
      'not a url?utm_source=x'
    );
  });

  test('trims surrounding whitespace on valid URLs', () => {
    expect(stripTrackers('  https://a.test/?gclid=1&k=2  ')).toBe(
      'https://a.test/?k=2'
    );
  });

  test('matches parameter names case-insensitively and removes repeats', () => {
    expect(
      stripTrackers('https://a.test/?UTM_Source=a&utm_source=b&FBCLID=1&keep=1')
    ).toBe('https://a.test/?keep=1');
    expect(stripTrackers('https://a.test/?hsCtaTracking=1&x=1')).toBe(
      'https://a.test/?x=1'
    );
  });

  test('removes the query string entirely when only trackers existed', () => {
    expect(stripTrackers('https://a.test/p?utm_medium=x#h')).toBe(
      'https://a.test/p#h'
    );
  });

  test('a URL without a query is only normalised', () => {
    expect(stripTrackers('https://a.test')).toBe('https://a.test/');
  });

  test('custom blacklist replaces the defaults and is trimmed and lowercased', () => {
    expect(
      stripTrackers('https://a.test/?ref=1&utm_source=x', [' REF ', 3])
    ).toBe('https://a.test/?utm_source=x');
  });

  test('non-array blacklist falls back to the defaults', () => {
    expect(stripTrackers('https://a.test/?utm_source=x&k=1', 'ref')).toBe(
      'https://a.test/?k=1'
    );
    expect(stripTrackers('https://a.test/?utm_source=x&k=1', null)).toBe(
      'https://a.test/?k=1'
    );
  });

  test('an empty custom blacklist removes nothing', () => {
    expect(stripTrackers('https://a.test/?utm_source=x', [])).toBe(
      'https://a.test/?utm_source=x'
    );
  });

  test('stripTrackersDetailed reports changed true and false', () => {
    expect(stripTrackersDetailed('https://a.test/?k=1&gclid=2')).toEqual({
      originalUrl: 'https://a.test/?k=1&gclid=2',
      cleanedUrl: 'https://a.test/?k=1',
      changed: true,
    });
    expect(stripTrackersDetailed('https://a.test/?k=1')).toMatchObject({
      changed: false,
    });
    expect(stripTrackersDetailed('garbage')).toEqual({
      originalUrl: 'garbage',
      cleanedUrl: 'garbage',
      changed: false,
    });
  });

  test('batchStrip accepts newline-delimited text (CRLF and blank lines)', () => {
    expect(
      batchStrip(
        'https://a.test/?utm_source=x&k=1\r\n\r\n  https://b.test/?fbclid=1 \n'
      )
    ).toEqual(['https://a.test/?k=1', 'https://b.test/']);
  });

  test('batchStrip handles defaults and a custom blacklist', () => {
    expect(batchStrip()).toEqual([]);
    expect(batchStrip([])).toEqual([]);
    expect(batchStrip(['https://a.test/?ref=1&k=1'], ['ref'])).toEqual([
      'https://a.test/?k=1',
    ]);
  });

  test('default export is stripTrackers and the default list is frozen', () => {
    expect(defaultStrip).toBe(stripTrackers);
    expect(Object.isFrozen(DEFAULT_TRACKER_PARAMS)).toBe(true);
    expect(DEFAULT_TRACKER_PARAMS).toContain('fbclid');
  });
});
