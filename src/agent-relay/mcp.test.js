/**
 * @jest-environment node
 */
const { PassThrough } = require('stream');
const { createMcpServer, TOOLS } = require('./mcp.cjs');

function harness(relayResult = { ok: true }) {
  const input = new PassThrough();
  const output = new PassThrough();
  const relay = { call: jest.fn(async () => relayResult) };
  createMcpServer({ relay, input, output });
  const lines = [];
  output.setEncoding('utf8');
  output.on('data', (chunk) =>
    chunk
      .split('\n')
      .filter(Boolean)
      .forEach((line) => lines.push(JSON.parse(line)))
  );
  const send = async (message) => {
    input.write(`${JSON.stringify(message)}\n`);
    await new Promise((r) => setTimeout(r, 10));
    return lines[lines.length - 1];
  };
  return { relay, send, lines, input };
}

describe('mcp server', () => {
  test('initialize negotiates a supported protocol version', async () => {
    const { send } = harness();
    const ok = await send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    });
    expect(ok.result.protocolVersion).toBe('2024-11-05');
    expect(ok.result.capabilities).toEqual({ tools: {} });
    const fallback = await send({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    });
    expect(fallback.result.protocolVersion).toBe('2025-06-18');
  });

  test('notifications get no reply and unknown methods error', async () => {
    const { send, lines } = harness();
    await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(lines).toHaveLength(0);
    const reply = await send({ jsonrpc: '2.0', id: 3, method: 'nope' });
    expect(reply.error.code).toBe(-32601);
    expect(
      (await send({ jsonrpc: '2.0', id: 4, method: 'ping' })).result
    ).toEqual({});
  });

  test('tools/list exposes every tool with a schema, never raw method access', async () => {
    const { send } = harness();
    const reply = await send({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    const names = reply.result.tools.map((t) => t.name);
    expect(names).toEqual(TOOLS.map((t) => t.name));
    expect(names).not.toContain('eval');
    reply.result.tools.forEach((t) =>
      expect(t.inputSchema.type).toBe('object')
    );
  });

  test('add_urls maps to addMany and reports bridge failures as isError', async () => {
    const { send, relay } = harness({
      ok: false,
      error: { code: 'invalid_input', message: 'x' },
    });
    const reply = await send({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'add_urls',
        arguments: {
          urls: [{ url: 'https://a.example' }],
          skipDuplicates: false,
        },
      },
    });
    expect(relay.call).toHaveBeenCalledWith('addMany', {
      inputs: [{ url: 'https://a.example' }],
      options: { skipDuplicates: false },
    });
    expect(reply.result.isError).toBe(true);
    expect(JSON.parse(reply.result.content[0].text).error.code).toBe(
      'invalid_input'
    );
  });

  test('unknown tools and bad JSON are protocol errors', async () => {
    const { send, input, lines } = harness();
    const reply = await send({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'drop_database' },
    });
    expect(reply.error.code).toBe(-32602);
    input.write('{broken\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(lines[lines.length - 1].error.code).toBe(-32700);
  });

  test('bridge_status reports connection state', async () => {
    const down = harness({
      ok: false,
      error: { code: 'no_client', message: 'none' },
    });
    const reply = await down.send({
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'bridge_status', arguments: {} },
    });
    expect(JSON.parse(reply.result.content[0].text).connected).toBe(false);
  });
});
