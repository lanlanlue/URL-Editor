import { batchProcessUrls } from './urlParser';

test.each([
  'javascript:alert(1)',
  'data:text/html,test',
  'ftp://example.com',
  'not a url',
])('batch replacement rejects entire transaction: %s', (replacement) => {
  const urls = [
    { id: 'a', url: 'https://one.test' },
    { id: 'b', url: 'https://two.test' },
  ];
  const result = batchProcessUrls(urls, {
    type: 'text',
    targetField: 'url',
    findText: 'https://one.test',
    replaceText: replacement,
  });
  expect(result.errors).toEqual([{ id: 'a', reason: 'invalid-url' }]);
  expect(result.updatedUrls).toEqual(urls);
  expect(result.affectedCount).toBe(0);
  expect(urls[0].url).toBe('https://one.test');
});

test('safe batch edits preserve unselected entries and labels are not URLs', () => {
  const urls = [
    { id: 'a', url: 'https://one.test', label: 'old' },
    { id: 'b', url: 'https://two.test' },
  ];
  const result = batchProcessUrls(urls, {
    type: 'text',
    findText: 'old',
    replaceText: 'javascript:label',
    targetField: 'label',
    filterIds: ['a'],
  });
  expect(result.updatedUrls[0].label).toBe('javascript:label');
  expect(result.updatedUrls[1]).toEqual(urls[1]);
  expect(result.affectedCount).toBe(1);
});
