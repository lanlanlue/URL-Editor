import { runEntryCheck } from './entryCheck.js';
import { getHistory } from './checkHistory.js';

const okResult = { status: 'online', code: 200, timeMs: 50, mode: 'full' };
const failResult = { status: 'offline', code: 500, timeMs: 40, mode: 'full' };

describe('runEntryCheck', () => {
  beforeEach(() => localStorage.clear());

  test('passes no keyword option and an undefined timeout without assertions', async () => {
    const check = jest.fn().mockResolvedValue({ ...okResult });
    const result = await runEntryCheck(
      { id: 'e1', url: 'https://a.test' },
      check
    );
    expect(check).toHaveBeenCalledWith('https://a.test', undefined, {});
    expect(result.regression).toBe(false);
    expect(result.recovered).toBe(false);
  });

  test('passes no keyword option when assertions have no keyword', async () => {
    const check = jest.fn().mockResolvedValue({ ...okResult });
    await runEntryCheck(
      {
        id: 'e2',
        url: 'https://a.test',
        assertions: { expectedStatus: '2xx' },
      },
      check
    );
    expect(check).toHaveBeenCalledWith('https://a.test', undefined, {});
  });

  test('forwards the keyword to the checker when asserted', async () => {
    const check = jest.fn().mockResolvedValue({ ...okResult });
    await runEntryCheck(
      { id: 'e3', url: 'https://a.test', assertions: { keyword: 'Welcome' } },
      check
    );
    expect(check).toHaveBeenCalledWith('https://a.test', undefined, {
      keyword: 'Welcome',
    });
  });

  test('records history and flags a regression then a recovery', async () => {
    const entry = {
      id: 'e4',
      url: 'https://a.test',
      assertions: { expectedStatus: '200' },
    };
    const check = jest
      .fn()
      .mockResolvedValueOnce({ ...okResult })
      .mockResolvedValueOnce({ ...failResult })
      .mockResolvedValueOnce({ ...okResult });
    const first = await runEntryCheck(entry, check);
    expect(first.regression).toBe(false);
    const second = await runEntryCheck(entry, check);
    expect(second.regression).toBe(true);
    expect(second.recovered).toBe(false);
    const third = await runEntryCheck(entry, check);
    expect(third.recovered).toBe(true);
  });

  test('propagates checker rejection', async () => {
    const check = jest.fn().mockRejectedValue(new Error('net'));
    await expect(
      runEntryCheck({ id: 'e5', url: 'https://a.test' }, check)
    ).rejects.toThrow('net');
  });
});
