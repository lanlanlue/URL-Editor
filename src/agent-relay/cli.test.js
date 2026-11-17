/** @jest-environment node */
const path = require('path');
const { spawnSync } = require('child_process');
jest.mock('./relay.cjs', () => ({
  createRelay: jest.fn(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('./mcp.cjs', () => ({ createMcpServer: jest.fn() }));
const { main, parsePort } = require('./cli.cjs');

test('CLI accepts documented ports and rejects invalid configuration', () => {
  expect(parsePort()).toBe(17891);
  expect(parsePort('1024')).toBe(1024);
  expect(parsePort('65535')).toBe(65535);
  for (const value of ['0', '1023', '65536', 'bad', '1.5', '']) {
    expect(() => parsePort(value)).toThrow('1024-65535');
  }
});

test('CLI wires startup and shutdown without exposing pairing data on stdout', async () => {
  const { createRelay } = require('./relay.cjs');
  const { createMcpServer } = require('./mcp.cjs');
  const signals = new Map();
  const on = jest.spyOn(process, 'on').mockImplementation((event, listener) => {
    signals.set(event, listener);
    return process;
  });
  const stdinOn = jest
    .spyOn(process.stdin, 'on')
    .mockReturnValue(process.stdin);
  const stderr = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
  const stdout = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
  const exit = jest.spyOn(process, 'exit').mockImplementation(() => {});
  try {
    await main({
      URL_EDITOR_RELAY_PORT: '17892',
      URL_EDITOR_APP_ORIGIN: 'https://unit.test',
      URL_EDITOR_ALLOWED_ORIGINS: 'https://extra.test, ',
      URL_EDITOR_RELAY_TOKEN: 'test-only-pairing',
    });
    const relay = createRelay.mock.results.at(-1).value;
    expect(createRelay).toHaveBeenLastCalledWith({
      token: 'test-only-pairing',
      port: 17892,
      allowedOrigins: [
        'https://unit.test',
        'http://localhost:1234',
        'http://127.0.0.1:1234',
        'https://extra.test',
      ],
    });
    expect(relay.start).toHaveBeenCalledTimes(1);
    expect(createMcpServer).toHaveBeenCalledWith(
      expect.objectContaining({
        relay,
        input: process.stdin,
        output: process.stdout,
      })
    );
    expect(stderr).toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stdinOn).toHaveBeenCalledWith('end', expect.any(Function));
    signals.get('SIGTERM')();
    await Promise.resolve();
    expect(relay.stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  } finally {
    on.mockRestore();
    stdinOn.mockRestore();
    stderr.mockRestore();
    stdout.mockRestore();
    exit.mockRestore();
  }
});

test('actual CLI fails before binding for invalid port, keeping stdout MCP-only', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'cli.cjs')],
    {
      env: { URL_EDITOR_RELAY_PORT: 'invalid' },
      encoding: 'utf8',
      timeout: 5000,
    }
  );
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('URL_EDITOR_RELAY_PORT');
});
