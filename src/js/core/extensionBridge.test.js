import {
  getActiveTabUrl,
  initExtensionBridge,
  isExtensionEnvironment,
} from './extensionBridge';

describe('extensionBridge', () => {
  afterEach(() => {
    delete global.chrome;
  });

  test('does nothing outside an extension environment', async () => {
    expect(isExtensionEnvironment()).toBe(false);
    expect(await initExtensionBridge()).toBeNull();
  });

  test('loads only an http(s) active tab URL', async () => {
    global.chrome = {
      tabs: {
        query: jest.fn((_query, callback) =>
          callback([{ url: 'https://example.com' }])
        ),
      },
    };
    const onUrl = jest.fn();
    expect(await getActiveTabUrl()).toBe('https://example.com');
    expect(await initExtensionBridge({ onUrl })).toBe('https://example.com');
    expect(onUrl).toHaveBeenCalledWith('https://example.com');
  });
});
