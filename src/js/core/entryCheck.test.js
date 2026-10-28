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
    expect(getHistory('e4')).toHaveLength(3);
  });

  test('propagates checker rejection', async () => {
    const check = jest.fn().mockRejectedValue(new Error('net'));
    await expect(
      runEntryCheck({ id: 'e5', url: 'https://a.test' }, check)
    ).rejects.toThrow('net');
  });
});

describe('runEntryCheck isCurrent predicate', () => {
  beforeEach(() => localStorage.clear());

  test('a stale check records nothing and returns a marked stale result', async () => {
    const check = jest.fn().mockResolvedValue({ ...okResult });
    const isCurrent = jest.fn(() => false);
    const result = await runEntryCheck(
      { id: 's1', url: 'https://a.test' },
      check,
      { isCurrent }
    );
    expect(check).toHaveBeenCalledTimes(1);
    expect(isCurrent).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ stale: true, status: 'checking' });
    expect(getHistory('s1')).toEqual([]);
  });

  test('a current check records exactly once', async () => {
    const check = jest.fn().mockResolvedValue({ ...okResult });
    const result = await runEntryCheck(
      { id: 's2', url: 'https://a.test' },
      check,
      { isCurrent: () => true }
    );
    expect(result.stale).toBeUndefined();
    expect(result.status).toBe('online');
    expect(getHistory('s2')).toHaveLength(1);
  });

  test('predicate is evaluated after the network check returns', async () => {
    let current = true;
    const check = jest.fn(async () => {
      current = false; // superseded while the request is in flight
      return { ...okResult };
    });
    const result = await runEntryCheck(
      { id: 's3', url: 'https://a.test' },
      check,
      { isCurrent: () => current }
    );
    expect(result.stale).toBe(true);
    expect(getHistory('s3')).toEqual([]);
  });
});
