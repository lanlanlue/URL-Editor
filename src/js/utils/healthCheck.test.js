import { checkUrlHealth } from './healthCheck';

describe('healthCheck', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  test('should return online status when fetch resolves with status 200 or opaque type', async () => {
    global.fetch.mockResolvedValueOnce({
      type: 'opaque',
      status: 0,
    });

    const res = await checkUrlHealth('https://example.com');
    expect(res.status).toBe('online');
  });

  test('should return offline status when fetch rejects with network error', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const res = await checkUrlHealth('https://invalid-host-xxxx.com');
    expect(res.status).toBe('offline');
  });
});
