#!/usr/bin/env node
'use strict';

// Starts the loopback relay and an MCP server on stdio. Intended to be launched
// by an MCP client (e.g. `claude mcp add url-editor -- node src/agent-relay/cli.cjs`).
// stdout carries MCP messages only; everything human-readable goes to stderr.

const crypto = require('crypto');
const { createRelay } = require('./relay.cjs');
const { createMcpServer } = require('./mcp.cjs');

const DEFAULT_PORT = 17891;
const DEFAULT_APP_ORIGIN = 'https://url-editor.ointw.com';
const DEV_ORIGINS = ['http://localhost:1234', 'http://127.0.0.1:1234'];

function log(message) {
  process.stderr.write(`[url-editor-relay] ${message}\n`);
}

function parsePort(value) {
  const port = value === undefined ? DEFAULT_PORT : Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('URL_EDITOR_RELAY_PORT must be an integer in 1024-65535.');
  }
  return port;
}

async function main(env = process.env) {
  const port = parsePort(env.URL_EDITOR_RELAY_PORT);
  const appOrigin = env.URL_EDITOR_APP_ORIGIN || DEFAULT_APP_ORIGIN;
  const extraOrigins = (env.URL_EDITOR_ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  // A fresh token per launch unless pinned; pinning trades safety for not
  // having to re-pair the tab every time the MCP client restarts.
  const token =
    env.URL_EDITOR_RELAY_TOKEN || crypto.randomBytes(24).toString('base64url');

  const relay = createRelay({
    token,
    port,
    allowedOrigins: [appOrigin, ...DEV_ORIGINS, ...extraOrigins],
  });
  await relay.start();
  createMcpServer({ relay, input: process.stdin, output: process.stdout, log });

  log(`listening on 127.0.0.1:${port}`);
  log(
    `pair a logged-in, unlocked tab by opening: ${appOrigin}/?agent=1#agent-relay=${port}:${token}`
  );

  const shutdown = () => {
    relay.stop().finally(() => process.exit(0));
  };
  process.stdin.on('end', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((error) => {
    log(error.code === 'EADDRINUSE' ? 'Port already in use.' : error.message);
    process.exit(1);
  });
}

module.exports = { main, parsePort };
