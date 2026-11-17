import {
  escapeCsvField,
  exportToCsvString,
  parseCsvLine,
  parseCsvString,
} from './csvParser';

describe('csvParser', () => {
  test('should escape fields containing commas or quotes', () => {
    expect(escapeCsvField('hello')).toBe('hello');
    expect(escapeCsvField('hello, world')).toBe('"hello, world"');
    expect(escapeCsvField('say "hello"')).toBe('"say ""hello"""');
  });

  test('should export URL entries to valid CSV string', () => {
    const urls = [
      {
        url: 'https://example.com/api?a=1,2',
        label: 'API Test',
        tags: ['dev', 'api'],
        usageCount: 5,
        isPinned: true,
      },
    ];

    const csv = exportToCsvString(urls);
    expect(csv).toContain('URL,Label,Tags,UsageCount,IsPinned');
    expect(csv).toContain('"https://example.com/api?a=1,2"');
    expect(csv).toContain('API Test');
    expect(csv).toContain('dev;api');
  });

  test('should parse CSV line with quoted fields', () => {
    const line = '"https://test.com", "Test, Label", "tag1;tag2", 10, true';
    const fields = parseCsvLine(line).map((f) => f.trim());

    expect(fields[0]).toBe('https://test.com');
    expect(fields[1]).toBe('Test, Label');
    expect(fields[2]).toBe('tag1;tag2');
  });

  test('should parse CSV string back to URL objects', () => {
    const csvContent = `URL,Label,Tags,UsageCount,IsPinned
"https://site.com",Site Label,qa;test,3,true
https://site2.com,Site 2,dev,0,false`;

    const parsed = parseCsvString(csvContent);
    expect(parsed.length).toBe(2);

    expect(parsed[0].url).toBe('https://site.com');
    expect(parsed[0].label).toBe('Site Label');
    expect(parsed[0].tags).toEqual(['qa', 'test']);
    expect(parsed[0].usageCount).toBe(3);
    expect(parsed[0].isPinned).toBe(true);

    expect(parsed[1].url).toBe('https://site2.com');
    expect(parsed[1].isPinned).toBe(false);
  });
});

test.each([
  '=1+1',
  '+CMD',
  '-1',
  '@SUM(A1)',
  '\tformula',
  '\rformula',
  '  =1',
  ' \ttext',
  '\n@SUM(A1)',
])('neutralizes spreadsheet field %j', (value) => {
  expect(parseCsvLine(escapeCsvField(value))).toEqual(["'" + value]);
});
test.each([
  "'original",
  "'=1",
  ' ordinary',
  'https://site.test/?x=1+2',
  'name-with-hyphen',
  0,
  true,
])('preserves ordinary data and existing apostrophes: %j', (value) => {
  expect(parseCsvLine(escapeCsvField(value))).toEqual([String(value)]);
});
test('export protects labels and tags without stripping apostrophes during import', () => {
  const csv = exportToCsvString([
    { url: 'https://site.test', label: ' =1', tags: ['@x'] },
  ]);
  const [entry] = parseCsvString(csv);
  expect(entry.label).toBe("' =1");
  expect(entry.tags).toEqual(["'@x"]);
});
