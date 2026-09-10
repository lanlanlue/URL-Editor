import { compareUrls, tryCompareUrls } from './urlDiff';

describe('urlDiff', () => {
  test('reports query additions, removals, and modifications', () => {
    const result = compareUrls(
      'https://example.com/v1?keep=yes&remove=1&edit=old',
      'https://example.com/v1?keep=yes&add=2&edit=new'
    );

    expect(result.domainChanged).toBe(false);
    expect(result.pathChanged).toBe(false);
    expect(result.addedParams).toEqual({ add: '2' });
    expect(result.removedParams).toEqual({ remove: '1' });
    expect(result.modifiedParams).toEqual({
      edit: { oldVal: 'old', newVal: 'new' },
    });
  });

  test('detects protocol/host and path changes', () => {
    const result = compareUrls(
      'http://old.example.com/a',
      'https://new.example.com/b'
    );
    expect(result.domainChanged).toBe(true);
    expect(result.protocolChanged).toBe(true);
    expect(result.pathChanged).toBe(true);
  });

  test('provides a non-throwing invalid input helper', () => {
    expect(() => compareUrls('', 'https://example.com')).toThrow(TypeError);
    expect(tryCompareUrls('', 'https://example.com')).toEqual({
      ok: false,
      error: expect.any(String),
    });
  });
});
