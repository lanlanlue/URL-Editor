/**
 * @jest-environment node
 */
// MCP stdio -> relay -> page client -> real agent bridge, in one process.
const { PassThrough } = require('stream');
const { createRelay } = require('./relay.cjs');
const { createMcpServer } = require('./mcp.cjs');

const TOKEN = 'e2e-token-0123456789ab';

test('an MCP tools/call edits the list through the paired page client', async () => {
  const { createAgentBridge } = require('../js/core/agentBridge');
  const { startRelayClient } = require('../js/core/agentRelayClient');

  let urls = [];
  const bridge = createAgentBridge({
    getUrls: () => urls,
    normalize: (entries) =>
      entries
        .filter((e) => {
          try {
            new URL(e.url);
            return true;
          } catch {
            return false;
          }
        })
        .map((e, i) => ({
          label: '',
          tags: [],
          usageCount: 0,
          lastUsed: 1,
          createdAt: 1,
          isPinned: false,
          ...e,
          id: e.id || `id${urls.length}-${i}`,
        })),
    commit: (next) => {
      urls = next;
    },
  });

  const relay = createRelay({
    token: TOKEN,
    allowedOrigins: [],
    pollTimeoutMs: 400,
    callTimeoutMs: 2000,
  });
  const { port } = await relay.start();
  const client = startRelayClient({ port, token: TOKEN, bridge });

  const input = new PassThrough();
  const output = new PassThrough();
  createMcpServer({ relay, input, output });
  const replies = new Map();
  output.setEncoding('utf8');
  output.on('data', (chunk) =>
    chunk
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        const message = JSON.parse(line);
        replies.set(message.id, message);
      })
  );
  const call = async (id, name, args) => {
    input.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`
    );
    for (let i = 0; i < 100 && !replies.has(id); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    return JSON.parse(replies.get(id).result.content[0].text);
  };

  try {
    // Wait for the client's first poll to register.
    for (let i = 0; i < 50 && !relay.isConnected(); i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const added = await call(1, 'add_urls', {
      urls: [
        { url: 'https://a.example/x', label: 'A', tags: ['qa'] },
        { url: 'nope' },
      ],
    });
    expect(added.added).toHaveLength(1);
    expect(added.skipped).toEqual([{ index: 1, reason: 'invalid_url' }]);
    expect(urls).toHaveLength(1);

    const listed = await call(2, 'list_urls', { tag: 'qa' });
    expect(listed.items.map((i) => i.label)).toEqual(['A']);

    const id = listed.items[0].id;
    await call(3, 'update_url', { id, patch: { label: 'A2' } });
    expect(urls[0].label).toBe('A2');

    await call(4, 'remove_urls', { ids: [id] });
    expect(urls).toHaveLength(0);
    await call(5, 'undo_last_change', {});
    expect(urls).toHaveLength(1);
  } finally {
    client.stop();
    await relay.stop();
  }
});
