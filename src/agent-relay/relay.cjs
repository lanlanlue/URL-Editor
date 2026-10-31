'use strict';

const http = require('http');
const crypto = require('crypto');

// Methods the page-side bridge exposes. Anything else is refused before it is
// ever queued, so the relay cannot be used to reach arbitrary page functions.
const ALLOWED_METHODS = Object.freeze([
  'describe',
  'list',
  'get',
  'add',
  'addMany',
  'update',
  'remove',
  'undo',
]);

const MAX_BODY_BYTES = 1024 * 1024;

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload_too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/**
 * A loopback-only rendezvous between an MCP server (calls) and the browser page
 * (which long-polls for work). The page dials out, so no inbound port is opened
 * on the browser side and the E2EE key never leaves the page.
 *
 * Every request must carry the bearer token, a loopback Host header (blocks DNS
 * rebinding) and, when it has one, an allow-listed Origin.
 */
function createRelay({
  token,
  allowedOrigins = [],
  host = '127.0.0.1',
  port = 0,
  pollTimeoutMs = 25000,
  callTimeoutMs = 20000,
} = {}) {
  if (typeof token !== 'string' || token.length < 16) {
    throw new Error('A token of at least 16 characters is required.');
  }
  const origins = new Set(allowedOrigins);
  const queue = [];
  const pending = new Map();
  let activePoll = null;
  let lastPollAt = 0;
  let server = null;
  let boundPort = port;
  let nextId = 1;

  function hostAllowed(headerValue) {
    if (typeof headerValue !== 'string') return false;
    return (
      headerValue === `127.0.0.1:${boundPort}` ||
      headerValue === `localhost:${boundPort}` ||
      headerValue === `[::1]:${boundPort}`
    );
  }

  function corsHeaders(origin) {
    if (!origin || !origins.has(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  }

  function send(response, status, body, headers = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    response.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...headers,
    });
    response.end(payload);
  }

  function isConnected() {
    return (
      Boolean(activePoll) || Date.now() - lastPollAt < pollTimeoutMs + 5000
    );
  }

  function deliverNext() {
    if (!activePoll || queue.length === 0) return;
    const poll = activePoll;
    activePoll = null;
    clearTimeout(poll.timer);
    const job = queue.shift();
    send(poll.response, 200, job.payload, poll.headers);
  }

  function handlePoll(request, response, headers) {
    lastPollAt = Date.now();
    if (activePoll) {
      // A newer poll (e.g. after a page reload) supersedes the old one.
      clearTimeout(activePoll.timer);
      send(activePoll.response, 204, undefined, activePoll.headers);
      activePoll = null;
    }
    const poll = { response, headers, timer: null };
    poll.timer = setTimeout(() => {
      if (activePoll === poll) activePoll = null;
      lastPollAt = Date.now();
      send(response, 204, undefined, headers);
    }, pollTimeoutMs);
    request.on('close', () => {
      if (activePoll === poll) {
        clearTimeout(poll.timer);
        activePoll = null;
        lastPollAt = Date.now();
      }
    });
    activePoll = poll;
    deliverNext();
  }

  async function handleResult(request, response, headers) {
    let parsed;
    try {
      parsed = JSON.parse(await readBody(request));
    } catch (error) {
      const tooLarge = error.message === 'payload_too_large';
      send(response, tooLarge ? 413 : 400, { error: 'bad_request' }, headers);
      return;
    }
    const entry = pending.get(parsed?.id);
    if (!entry) {
      send(response, 404, { error: 'unknown_request' }, headers);
      return;
    }
    pending.delete(parsed.id);
    clearTimeout(entry.timer);
    entry.resolve(parsed.result);
    send(response, 200, { ok: true }, headers);
  }

  function handle(request, response) {
    const origin = request.headers.origin;
    const headers = corsHeaders(origin);

    if (!hostAllowed(request.headers.host)) {
      send(response, 403, { error: 'bad_host' });
      return;
    }
    if (origin && !origins.has(origin)) {
      send(response, 403, { error: 'origin_not_allowed' });
      return;
    }
    if (request.method === 'OPTIONS') {
      // Preflight carries no credentials by design; it reveals nothing.
      response.writeHead(204, headers);
      response.end();
      return;
    }
    const auth = request.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || !safeEqual(auth.slice(7), token)) {
      send(response, 401, { error: 'unauthorized' }, headers);
      return;
    }
    const path = (request.url || '').split('?')[0];
    if (request.method === 'GET' && path === '/poll') {
      handlePoll(request, response, headers);
    } else if (request.method === 'POST' && path === '/result') {
      handleResult(request, response, headers).catch(() =>
        send(response, 500, { error: 'internal' }, headers)
      );
    } else {
      send(response, 404, { error: 'not_found' }, headers);
    }
  }

  /**
   * Runs a bridge method in the paired page. Always resolves with the bridge's
   * own `{ ok, ... }` shape; transport problems become `{ ok: false, error }`.
   */
  function call(method, params = {}) {
    if (!ALLOWED_METHODS.includes(method)) {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'unknown_method',
          message: `Unknown method "${method}".`,
        },
      });
    }
    if (!isConnected()) {
      return Promise.resolve({
        ok: false,
        error: {
          code: 'no_client',
          message:
            'No paired URL Editor tab is connected. Open the pairing URL in a logged-in, unlocked tab.',
        },
      });
    }
    const id = `r${nextId++}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({
          ok: false,
          error: {
            code: 'timeout',
            message: 'The page did not answer in time.',
          },
        });
      }, callTimeoutMs);
      pending.set(id, { resolve, timer });
      queue.push({ payload: { id, method, params } });
      deliverNext();
    });
  }

  function start() {
    return new Promise((resolve, reject) => {
      server = http.createServer(handle);
      server.once('error', reject);
      server.listen(port, host, () => {
        boundPort = server.address().port;
        resolve({ port: boundPort, host });
      });
    });
  }

  function stop() {
    pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.resolve({
        ok: false,
        error: { code: 'shutdown', message: 'The relay is shutting down.' },
      });
    });
    pending.clear();
    if (activePoll) {
      clearTimeout(activePoll.timer);
      send(activePoll.response, 204, undefined, activePoll.headers);
      activePoll = null;
    }
    return new Promise((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }

  return { start, stop, call, isConnected };
}

module.exports = { createRelay, ALLOWED_METHODS };
