'use strict';

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'url-editor-agent', version: '1.0.0' };

const TAGS = { type: 'array', items: { type: 'string' } };
const ENTRY_PROPS = {
  url: { type: 'string', description: 'Absolute http(s) URL.' },
  label: { type: 'string' },
  tags: TAGS,
  isPinned: { type: 'boolean' },
};

// Each tool maps one-to-one onto a bridge method; `map` shapes the arguments.
const TOOLS = [
  {
    name: 'bridge_status',
    description:
      'Reports whether a paired, unlocked URL Editor tab is connected, and lists the bridge API.',
    inputSchema: { type: 'object', properties: {} },
    method: 'describe',
  },
  {
    name: 'list_urls',
    description: 'Lists saved URLs, optionally filtered by text or tag.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Matches URL, label or tags.' },
        tag: { type: 'string' },
        limit: { type: 'integer', minimum: 1 },
      },
    },
    method: 'list',
  },
  {
    name: 'get_url',
    description: 'Gets one saved URL by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    method: 'get',
  },
  {
    name: 'add_urls',
    description:
      'Adds URLs (max 200). Invalid and duplicate URLs are skipped and reported.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: ENTRY_PROPS,
            required: ['url'],
          },
        },
        skipDuplicates: { type: 'boolean', default: true },
      },
      required: ['urls'],
    },
    method: 'addMany',
    map: (args) => ({
      inputs: args.urls,
      options: { skipDuplicates: args.skipDuplicates !== false },
    }),
  },
  {
    name: 'update_url',
    description:
      'Updates url, label, tags or isPinned of one entry. Other fields are ignored.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        patch: { type: 'object', properties: ENTRY_PROPS },
      },
      required: ['id', 'patch'],
    },
    method: 'update',
  },
  {
    name: 'remove_urls',
    description: 'Removes entries by id. Reversible with undo_last_change.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', minItems: 1, items: { type: 'string' } },
      },
      required: ['ids'],
    },
    method: 'remove',
  },
  {
    name: 'undo_last_change',
    description: 'Reverts the most recent write (up to 20 steps).',
    inputSchema: { type: 'object', properties: {} },
    method: 'undo',
  },
];

function toolResult(result) {
  const failed = !result || result.ok !== true;
  return {
    content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
    isError: failed,
  };
}

/**
 * Minimal MCP server over newline-delimited JSON-RPC (stdio transport). Only
 * what a tools-only server needs: initialize, ping, tools/list, tools/call.
 */
function createMcpServer({ relay, input, output, log = () => {} }) {
  function write(message) {
    output.write(`${JSON.stringify(message)}\n`);
  }

  function reply(id, result) {
    write({ jsonrpc: '2.0', id, result });
  }

  function replyError(id, code, message) {
    write({ jsonrpc: '2.0', id, error: { code, message } });
  }

  async function callTool(name, args) {
    const tool = TOOLS.find((item) => item.name === name);
    if (!tool) return null;
    const params = tool.map ? tool.map(args || {}) : args || {};
    const result = await relay.call(tool.method, params);
    if (name === 'bridge_status' && result?.ok) {
      return { ...result, connected: true };
    }
    if (name === 'bridge_status') return { ...result, connected: false };
    return result;
  }

  async function handle(message) {
    const { id, method, params } = message;
    const isRequest = id !== undefined && id !== null;
    if (!method) return;
    if (!isRequest) return; // notifications (e.g. notifications/initialized)

    switch (method) {
      case 'initialize': {
        const asked = params?.protocolVersion;
        reply(id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(asked)
            ? asked
            : SUPPORTED_PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        return;
      }
      case 'ping':
        reply(id, {});
        return;
      case 'tools/list':
        reply(id, {
          tools: TOOLS.map(({ name, description, inputSchema }) => ({
            name,
            description,
            inputSchema,
          })),
        });
        return;
      case 'tools/call': {
        const result = await callTool(params?.name, params?.arguments);
        if (result === null) {
          replyError(id, -32602, `Unknown tool: ${params?.name}`);
          return;
        }
        reply(id, toolResult(result));
        return;
      }
      default:
        replyError(id, -32601, `Method not found: ${method}`);
    }
  }

  let buffer = '';
  function onData(chunk) {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        replyError(null, -32700, 'Parse error');
        continue;
      }
      handle(message).catch((error) => {
        log(`handler error: ${error.message}`);
        if (message.id !== undefined) {
          replyError(message.id, -32603, 'Internal error');
        }
      });
    }
  }

  input.setEncoding('utf8');
  input.on('data', onData);

  return { tools: TOOLS };
}

module.exports = { createMcpServer, TOOLS, SUPPORTED_PROTOCOLS };
