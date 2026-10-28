import {
  getActiveTabUrl,
  initExtensionBridge,
  isExtensionEnvironment,
  requestHostPermissions,
  toOriginPattern,
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

  test('toOriginPattern keeps only http(s) origins', () => {
    expect(toOriginPattern('https://a.test:8443/x?y=1')).toBe(
      'https://a.test/*'
    );
    expect(toOriginPattern('ftp://a.test')).toBeNull();
    expect(toOriginPattern('not a url')).toBeNull();
  });

  test('requestHostPermissions asks once for de-duplicated origins', async () => {
    const request = jest.fn((_q, cb) => cb(true));
    global.chrome = { tabs: {}, permissions: { contains: jest.fn(), request } };

    const granted = await requestHostPermissions([
      'https://a.test/one',
      'https://a.test/two',
      'http://b.test',
    ]);
    expect(granted).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toEqual({
      origins: ['https://a.test/*', 'http://b.test/*'],
    });
  });

  test('requestHostPermissions is false without the permissions API', async () => {
    expect(await requestHostPermissions(['https://a.test'])).toBe(false);
  });
});
