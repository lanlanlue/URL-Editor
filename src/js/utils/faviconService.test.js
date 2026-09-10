import { createFaviconImg, DEFAULT_FAVICON_SVG } from './faviconService';

describe('utils/faviconService', () => {
  test('renders a local placeholder without probing the URL', () => {
    const imageConstructor = jest.spyOn(global, 'Image');

    const img = createFaviconImg(
      'https://staging.shadylady.tech/path?utm_source=test',
      'url-card__favicon'
    );

    expect(img).toBeInstanceOf(HTMLImageElement);
    expect(img.className).toBe('url-card__favicon');
    expect(img.alt).toBe('');
    expect(img.src).toBe(DEFAULT_FAVICON_SVG);
    expect(imageConstructor).not.toHaveBeenCalled();

    imageConstructor.mockRestore();
  });

  test('keeps malformed URLs on the same local fallback', () => {
    const img = createFaviconImg('not a URL', 'favicon');

    expect(img.src).toBe(DEFAULT_FAVICON_SVG);
    expect(img.dataset.favDomain).toBeUndefined();
  });
});
