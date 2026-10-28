import { PROBE_LIMITS, runProbe } from './probe.js';

const MAX_BODY_BYTES = 1024 * 1024;
const SESSION_DAYS = 30;
const SESSION_ROTATION_DAYS = 7;
const RECENT_AUTH_MINUTES = 10;
const HISTORY_LIMIT = 20;
const HISTORY_RETENTION_DAYS = 30;
const JWKS_TIMEOUT_MS = 3000;
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

let googleJwksCache = null;
const rateBuckets = new Map();

function json(data, status = 200, headers = {}) {
  const responseHeaders = { ...headers };
  const setCookies = responseHeaders['Set-Cookie'];
  delete responseHeaders['Set-Cookie'];
  const resultHeaders = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...responseHeaders,
  });
  if (Array.isArray(setCookies)) {
    setCookies.forEach((cookie) => resultHeaders.append('Set-Cookie', cookie));
  } else if (setCookies) {
    resultHeaders.append('Set-Cookie', setCookies);
  }
  return new Response(JSON.stringify(data), {
    status,
    headers: resultHeaders,
  });
}

function errorResponse(status, code, message) {
  return json({ error: message, code }, status);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = '';
  value.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlToJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function sha256(value) {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function parseCookies(request) {
  const cookies = {};
  (request.headers.get('Cookie') || '').split(';').forEach((part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return;
    const key = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }
    if (key) cookies[key] = value;
  });
  return cookies;
}

function sessionCookie(token, maxAge = SESSION_DAYS * 24 * 60 * 60) {
  return `__Host-ue_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie() {
  return '__Host-ue_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax';
}

function oauthCsrfCookie(token) {
  return `__Host-ue_oauth_csrf=${encodeURIComponent(token)}; Max-Age=600; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

function clearOauthCsrfCookie() {
  return '__Host-ue_oauth_csrf=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax';
}

function assertMutationOrigin(request) {
  const origin = request.headers.get('Origin');
  return Boolean(origin) && origin === new URL(request.url).origin;
}

function isOAuthOriginAllowed(request, env) {
  const hostname = new URL(request.url).hostname;
  return (
    env.ALLOW_PREVIEW_OAUTH === 'true' ||
    hostname === 'url-editor.ointw.com' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function clientAddress(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For') ||
    'unknown'
  );
}

function rateLimit(key, max, windowMs) {
  const currentTime = Date.now();
  const bucket = rateBuckets.get(key) || { startedAt: currentTime, count: 0 };
  if (currentTime - bucket.startedAt >= windowMs) {
    bucket.startedAt = currentTime;
    bucket.count = 0;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (rateBuckets.size > 5000) {
    for (const [bucketKey, value] of rateBuckets) {
      if (currentTime - value.startedAt >= windowMs)
        rateBuckets.delete(bucketKey);
    }
  }
  return bucket.count <= max;
}

async function readJson(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  if (!buffer.byteLength) return {};
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new Error('INVALID_JSON');
  }
}

// Only these sentinels thrown by readJson may reach the client as a code; any
// other error (e.g. a stream failure) is reported as INVALID_BODY so internal
// messages are never echoed.
function bodyErrorResponse(error, message) {
  if (error?.message === 'PAYLOAD_TOO_LARGE')
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', message);
  if (error?.message === 'INVALID_JSON')
    return errorResponse(422, 'INVALID_JSON', message);
  return errorResponse(422, 'INVALID_BODY', message);
}

function exactKeys(object, allowed) {
  return (
    object &&
    typeof object === 'object' &&
    !Array.isArray(object) &&
    Object.keys(object).every((key) => allowed.has(key))
  );
}

async function getGoogleJwks() {
  if (googleJwksCache && googleJwksCache.expiresAt > Date.now())
    return googleJwksCache.keys;
  // AbortController + timer rather than AbortSignal.timeout so it also works
  // where that static is missing (jsdom); the timer covers the body read too.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JWKS_TIMEOUT_MS);
  let response;
  let payload;
  try {
    response = await fetch(GOOGLE_JWKS_URL, {
      cf: { cacheTtl: 3600 },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('GOOGLE_JWKS_UNAVAILABLE');
    payload = await response.json();
  } finally {
    clearTimeout(timer);
  }
  const maxAge = /max-age=(\d+)/i.exec(
    response.headers.get('Cache-Control') || ''
  )?.[1];
  googleJwksCache = {
    keys: payload.keys || [],
    expiresAt: Date.now() + Math.min(Number(maxAge || 3600), 3600) * 1000,
  };
  return googleJwksCache.keys;
}

async function verifyGoogleCredential(credential, env) {
  if (
    typeof credential !== 'string' ||
    credential.length < 100 ||
    credential.length > 10000
  ) {
    throw new Error('INVALID_GOOGLE_CREDENTIAL');
  }
  const parts = credential.split('.');
  if (parts.length !== 3) throw new Error('INVALID_GOOGLE_CREDENTIAL');
  const header = base64UrlToJson(parts[0]);
  const claims = base64UrlToJson(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string')
    throw new Error('INVALID_GOOGLE_CREDENTIAL');
  const keys = await getGoogleJwks();
  const jwk = keys.find((key) => key.kid === header.kid);
  if (!jwk) throw new Error('INVALID_GOOGLE_CREDENTIAL');
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const validSignature = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    publicKey,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
  );
  const issuerValid =
    claims.iss === 'https://accounts.google.com' ||
    claims.iss === 'accounts.google.com';
  const audienceValid = Array.isArray(claims.aud)
    ? claims.aud.includes(env.GOOGLE_CLIENT_ID)
    : claims.aud === env.GOOGLE_CLIENT_ID;
  if (
    !validSignature ||
    !issuerValid ||
    !audienceValid ||
    typeof claims.exp !== 'number' ||
    !Number.isFinite(claims.exp) ||
    claims.exp <= nowSeconds() ||
    claims.email_verified !== true ||
    typeof claims.sub !== 'string'
  ) {
    throw new Error('INVALID_GOOGLE_CREDENTIAL');
  }
  return claims;
}

async function createSession(env, userId) {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const currentTime = nowSeconds();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, csrf_hash, user_id, created_at, last_rotated_at, expires_at, last_authenticated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(
      await sha256(token),
      await sha256(csrfToken),
      userId,
      currentTime,
      currentTime,
      currentTime + SESSION_DAYS * 86400,
      currentTime
    )
    .run();
  return { token, csrfToken };
}

// Re-resolves a session row whose token_hash was changed by a concurrent
// rotation, using only columns that no UPDATE in this file ever changes
// (user_id, created_at, last_authenticated_at, expires_at); csrf_hash is NOT
// stable (the winner usually re-issues it). The winner has a strictly newer
// last_rotated_at than the stale row, which excludes unrotated look-alike
// sessions; ORDER BY picks the most recently rotated row if several match.
async function findRotatedSession(env, session) {
  return env.DB.prepare(
    'SELECT token_hash FROM sessions WHERE user_id = ? AND created_at = ? AND last_authenticated_at = ? AND expires_at = ? AND last_rotated_at > ? ORDER BY last_rotated_at DESC LIMIT 1'
  )
    .bind(
      session.user_id,
      session.created_at,
      session.last_authenticated_at,
      session.expires_at,
      session.last_rotated_at
    )
    .first();
}

async function getSession(request, env, { rotate = true } = {}) {
  const token = parseCookies(request)['__Host-ue_session'];
  if (!token) return null;
  const session = await env.DB.prepare(
    'SELECT s.*, u.id AS account_id, u.google_sub, u.email, u.display_name FROM sessions s INNER JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? LIMIT 1'
  )
    .bind(await sha256(token))
    .first();
  if (!session || Number(session.expires_at) <= nowSeconds()) return null;

  if (
    rotate &&
    nowSeconds() - Number(session.last_rotated_at) >=
      SESSION_ROTATION_DAYS * 86400
  ) {
    const rotatedToken = randomToken(32);
    const rotatedHash = await sha256(rotatedToken);
    const result = await env.DB.prepare(
      'UPDATE sessions SET token_hash = ?, last_rotated_at = ? WHERE token_hash = ?'
    )
      .bind(rotatedHash, nowSeconds(), session.token_hash)
      .run();
    // A concurrent request with the same old token may have rotated first; its
    // UPDATE then matches 0 rows. Only the winner may hand out the new cookie,
    // otherwise the browser would hold a token that is not in the DB.
    if (result?.meta?.changes === 1) {
      session.token_hash = rotatedHash;
      session.setCookie = sessionCookie(
        rotatedToken,
        Math.max(0, Number(session.expires_at) - nowSeconds())
      );
    } else {
      // Lost the race: the row now lives under the winner's token hash, so
      // the stale hash would make later UPDATE/DELETE statements match 0 rows.
      // Re-resolve the same row using only columns that no UPDATE in this file
      // ever changes (user_id, created_at, last_authenticated_at, expires_at);
      // csrf_hash is NOT stable (the winner usually re-issues it). The winner
      // has a strictly newer last_rotated_at than the stale row, which
      // excludes unrotated look-alike sessions; ORDER BY picks the most
      // recently rotated row if several still match.
      const current = await findRotatedSession(env, session);
      if (!current?.token_hash) return null;
      session.token_hash = current.token_hash;
    }
  }
  return session;
}

async function issueCsrfToken(env, session) {
  const token = randomToken(32);
  await env.DB.prepare('UPDATE sessions SET csrf_hash = ? WHERE token_hash = ?')
    .bind(await sha256(token), session.token_hash)
    .run();
  return token;
}

async function requireSession(request, env, options = {}) {
  const session = await getSession(request, env, options);
  if (!session)
    throw new Response(
      JSON.stringify({
        error: 'Authentication required.',
        code: 'UNAUTHORIZED',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  return session;
}

async function requireCsrf(request, session) {
  const supplied = request.headers.get('X-CSRF-Token');
  if (!supplied || !((await sha256(supplied)) === session.csrf_hash)) {
    throw new Response(
      JSON.stringify({
        error: 'CSRF validation failed.',
        code: 'CSRF_INVALID',
      }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

function parseEtag(value) {
  const match = /^"rev-(\d+)"$/.exec(value || '');
  return match ? Number(match[1]) : null;
}

function isBase64Url(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value);
}

function validateEnvelope(envelope) {
  const allowed = new Set([
    'revision',
    'payloadSchemaVersion',
    'keyVersion',
    'kdfSalt',
    'iv',
    'ciphertext',
  ]);
  if (!exactKeys(envelope, allowed)) return false;
  if (!Number.isInteger(envelope.revision) || envelope.revision < 1)
    return false;
  if (
    envelope.payloadSchemaVersion !== 1 ||
    !Number.isInteger(envelope.keyVersion) ||
    envelope.keyVersion < 1
  )
    return false;
  try {
    if (
      !isBase64Url(envelope.kdfSalt) ||
      base64UrlToBytes(envelope.kdfSalt).length !== 16
    )
      return false;
    if (
      !isBase64Url(envelope.iv) ||
      base64UrlToBytes(envelope.iv).length !== 12
    )
      return false;
    if (!isBase64Url(envelope.ciphertext)) return false;
    const ciphertextLength = base64UrlToBytes(envelope.ciphertext).length;
    return ciphertextLength >= 16 && ciphertextLength <= MAX_BODY_BYTES;
  } catch {
    return false;
  }
}

function documentEnvelope(document) {
  if (!document) return null;
  return {
    revision: Number(document.revision),
    payloadSchemaVersion: Number(document.payload_schema_version),
    keyVersion: Number(document.key_version),
    kdfSalt: document.kdf_salt,
    iv: document.iv,
    ciphertext: document.ciphertext,
  };
}

function responseHeaders(session, extra = {}) {
  const headers = { ...extra };
  if (session?.setCookie) headers['Set-Cookie'] = session.setCookie;
  return headers;
}

async function authenticateGoogle(request, env) {
  if (!assertMutationOrigin(request))
    return errorResponse(403, 'ORIGIN_INVALID', 'Origin is not allowed.');
  if (!isOAuthOriginAllowed(request, env))
    return errorResponse(403, 'OAUTH_DISABLED', 'OAuth is disabled here.');
  const address = clientAddress(request);
  if (!rateLimit(`auth:${address}`, 10, 15 * 60 * 1000))
    return errorResponse(429, 'RATE_LIMITED', 'Too many login attempts.');
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return bodyErrorResponse(error, 'Invalid request body.');
  }
  if (
    !exactKeys(body, new Set(['credential', 'csrfToken'])) ||
    typeof body.csrfToken !== 'string'
  )
    return errorResponse(422, 'INVALID_BODY', 'Invalid login request.');
  const cookies = parseCookies(request);
  if (
    !cookies['__Host-ue_oauth_csrf'] ||
    cookies['__Host-ue_oauth_csrf'] !== body.csrfToken
  )
    return errorResponse(403, 'CSRF_INVALID', 'Login CSRF validation failed.');
  let claims;
  try {
    claims = await verifyGoogleCredential(body.credential, env);
  } catch {
    return errorResponse(
      401,
      'GOOGLE_TOKEN_INVALID',
      'Google credential could not be verified.'
    );
  }
  const currentTime = nowSeconds();
  let user = await env.DB.prepare(
    'SELECT id FROM users WHERE google_sub = ? LIMIT 1'
  )
    .bind(claims.sub)
    .first();
  if (!user) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO users (id, google_sub, email, display_name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(
        id,
        claims.sub,
        String(claims.email || '').slice(0, 320),
        String(claims.name || '').slice(0, 200),
        currentTime,
        currentTime
      )
      .run();
    user = { id };
  } else {
    await env.DB.prepare(
      'UPDATE users SET email = ?, display_name = ?, last_login_at = ? WHERE id = ?'
    )
      .bind(
        String(claims.email || '').slice(0, 320),
        String(claims.name || '').slice(0, 200),
        currentTime,
        user.id
      )
      .run();
  }
  const created = await createSession(env, user.id);
  return json(
    {
      user: { id: user.id, email: claims.email || '', name: claims.name || '' },
      csrfToken: created.csrfToken,
    },
    200,
    {
      'Set-Cookie': [sessionCookie(created.token), clearOauthCsrfCookie()],
    }
  );
}

async function handleSyncGet(request, env) {
  const session = await requireSession(request, env);
  const document = await env.DB.prepare(
    'SELECT * FROM sync_documents WHERE user_id = ? LIMIT 1'
  )
    .bind(session.account_id)
    .first();
  const envelope = documentEnvelope(document);
  return json(
    { document: envelope, revision: envelope?.revision || 0 },
    200,
    responseHeaders(session, { ETag: `"rev-${envelope?.revision || 0}"` })
  );
}

async function cleanupHistory(env, userId) {
  const cutoff = nowSeconds() - HISTORY_RETENTION_DAYS * 86400;
  await env.DB.prepare(
    `DELETE FROM sync_revisions WHERE user_id = ? AND (created_at < ? OR revision NOT IN (SELECT revision FROM sync_revisions WHERE user_id = ? ORDER BY revision DESC LIMIT ${HISTORY_LIMIT}))`
  )
    .bind(userId, cutoff, userId)
    .run();
}

async function handleSyncPut(request, env) {
  if (!assertMutationOrigin(request))
    return errorResponse(403, 'ORIGIN_INVALID', 'Origin is not allowed.');
  const session = await requireSession(request, env);
  await requireCsrf(request, session);
  if (!rateLimit(`sync:${session.account_id}`, 120, 60 * 60 * 1000))
    return errorResponse(429, 'RATE_LIMITED', 'Too many sync requests.');
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return bodyErrorResponse(error, 'Invalid sync body.');
  }
  if (!validateEnvelope(body))
    return errorResponse(
      422,
      'INVALID_ENVELOPE',
      'Invalid encrypted envelope.'
    );
  const expectedRevision = parseEtag(request.headers.get('If-Match'));
  if (expectedRevision === null)
    return errorResponse(
      422,
      'IF_MATCH_REQUIRED',
      'If-Match revision is required.'
    );
  const current = await env.DB.prepare(
    'SELECT * FROM sync_documents WHERE user_id = ? LIMIT 1'
  )
    .bind(session.account_id)
    .first();
  const currentRevision = Number(current?.revision || 0);
  if (
    expectedRevision !== currentRevision ||
    body.revision !== currentRevision + 1
  )
    return errorResponse(
      409,
      'SYNC_CONFLICT',
      'The encrypted document has changed.'
    );
  const currentTime = nowSeconds();
  try {
    if (current) {
      const results = await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO sync_revisions (user_id, revision, payload_schema_version, key_version, kdf_salt, iv, ciphertext, created_at) SELECT user_id, revision, payload_schema_version, key_version, kdf_salt, iv, ciphertext, created_at FROM sync_documents WHERE user_id = ? AND revision = ?'
        ).bind(session.account_id, currentRevision),
        env.DB.prepare(
          'UPDATE sync_documents SET revision = ?, payload_schema_version = ?, key_version = ?, kdf_salt = ?, iv = ?, ciphertext = ?, updated_at = ? WHERE user_id = ? AND revision = ?'
        ).bind(
          body.revision,
          body.payloadSchemaVersion,
          body.keyVersion,
          body.kdfSalt,
          body.iv,
          body.ciphertext,
          currentTime,
          session.account_id,
          currentRevision
        ),
      ]);
      if (!results?.[1]?.meta?.changes)
        return errorResponse(
          409,
          'SYNC_CONFLICT',
          'The encrypted document has changed.'
        );
    } else {
      await env.DB.prepare(
        'INSERT INTO sync_documents (user_id, revision, payload_schema_version, key_version, kdf_salt, iv, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
        .bind(
          session.account_id,
          body.revision,
          body.payloadSchemaVersion,
          body.keyVersion,
          body.kdfSalt,
          body.iv,
          body.ciphertext,
          currentTime
        )
        .run();
    }
  } catch {
    return errorResponse(
      409,
      'SYNC_CONFLICT',
      'The encrypted document has changed.'
    );
  }
  // The write is committed; a failed history cleanup must not be reported as a
  // conflict. It is retried on the next successful write.
  try {
    await cleanupHistory(env, session.account_id);
  } catch {
    // best effort; fixed message only so no user data reaches the logs
    console.warn('Sync history cleanup failed');
  }
  return json(
    { document: body, revision: body.revision },
    200,
    responseHeaders(session, { ETag: `"rev-${body.revision}"` })
  );
}

async function handleRevisions(request, env, revision) {
  const session = await requireSession(request, env);
  if (revision === undefined) {
    const result = await env.DB.prepare(
      'SELECT revision, key_version, created_at FROM sync_revisions WHERE user_id = ? ORDER BY revision DESC LIMIT ?'
    )
      .bind(session.account_id, HISTORY_LIMIT)
      .all();
    return json(
      { revisions: result.results || [] },
      200,
      responseHeaders(session)
    );
  }
  const parsedRevision = Number(revision);
  if (!Number.isInteger(parsedRevision) || parsedRevision < 1)
    return errorResponse(422, 'INVALID_REVISION', 'Invalid revision.');
  const row = await env.DB.prepare(
    'SELECT * FROM sync_revisions WHERE user_id = ? AND revision = ? LIMIT 1'
  )
    .bind(session.account_id, parsedRevision)
    .first();
  if (!row)
    return errorResponse(404, 'REVISION_NOT_FOUND', 'Revision not found.');
  return json(
    { envelope: documentEnvelope(row) },
    200,
    responseHeaders(session)
  );
}

async function handleLogout(request, env) {
  if (!assertMutationOrigin(request))
    return errorResponse(403, 'ORIGIN_INVALID', 'Origin is not allowed.');
  const session = await requireSession(request, env, { rotate: false });
  await requireCsrf(request, session);
  // A rotation by another request may land between getSession and this DELETE,
  // leaving the row under a new hash (0 rows deleted). Re-resolve and retry a
  // bounded number of times so the user is not left logged in.
  let current = session;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await env.DB.prepare(
      'DELETE FROM sessions WHERE token_hash = ?'
    )
      .bind(current.token_hash)
      .run();
    if (result?.meta?.changes !== 0) break;
    const rotated = await findRotatedSession(env, current);
    if (!rotated?.token_hash) break; // already gone
    current = { ...current, token_hash: rotated.token_hash };
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}

async function handleDeleteAccount(request, env) {
  if (!assertMutationOrigin(request))
    return errorResponse(403, 'ORIGIN_INVALID', 'Origin is not allowed.');
  const session = await requireSession(request, env, { rotate: false });
  await requireCsrf(request, session);
  if (
    nowSeconds() - Number(session.last_authenticated_at) >
    RECENT_AUTH_MINUTES * 60
  )
    return errorResponse(
      403,
      'RECENT_AUTH_REQUIRED',
      'Please sign in again before deleting the account.'
    );
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    // Malformed JSON has always been INVALID_BODY here; keep that code.
    if (error?.message === 'INVALID_JSON')
      return errorResponse(422, 'INVALID_BODY', 'Invalid delete request.');
    return bodyErrorResponse(error, 'Invalid delete request.');
  }
  if (
    !exactKeys(body, new Set(['confirmation'])) ||
    body.confirmation !== 'DELETE'
  )
    return errorResponse(
      422,
      'CONFIRMATION_REQUIRED',
      'Account deletion confirmation is required.'
    );
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sync_revisions WHERE user_id = ?').bind(
      session.account_id
    ),
    env.DB.prepare('DELETE FROM sync_documents WHERE user_id = ?').bind(
      session.account_id
    ),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(
      session.account_id
    ),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(session.account_id),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}

// Side-effect free, so session cookie + same-origin check + rate limit is used
// instead of a CSRF token (issuing one would invalidate the sync client's).
async function handleProbe(request, env) {
  if (!assertMutationOrigin(request))
    return errorResponse(403, 'ORIGIN_INVALID', 'Origin is not allowed.');
  const session = await requireSession(request, env, { rotate: false });
  if (!rateLimit(`probe:${session.account_id}`, 120, 60 * 1000))
    return errorResponse(429, 'RATE_LIMITED', 'Too many probe requests.');
  let body;
  try {
    body = await readJson(request);
  } catch (error) {
    return bodyErrorResponse(error, 'Invalid probe request.');
  }
  if (
    !exactKeys(body, new Set(['url', 'keyword'])) ||
    typeof body.url !== 'string' ||
    (body.keyword !== undefined &&
      (typeof body.keyword !== 'string' ||
        body.keyword.length > PROBE_LIMITS.maxKeywordLength))
  )
    return errorResponse(422, 'INVALID_BODY', 'Invalid probe request.');
  const result = await runProbe(body.url, { keyword: body.keyword || '' });
  if (result.blocked) return errorResponse(422, 'URL_BLOCKED', result.reason);
  return json(result);
}

export async function handleApiRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  try {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204 });
    if (request.method === 'GET' && path === 'auth/csrf') {
      const token = randomToken(32);
      return json({ csrfToken: token }, 200, {
        'Set-Cookie': oauthCsrfCookie(token),
      });
    }
    if (request.method === 'GET' && path === 'config') {
      return json({
        googleClientId: isOAuthOriginAllowed(request, env)
          ? env.GOOGLE_CLIENT_ID || ''
          : '',
      });
    }
    if (request.method === 'POST' && path === 'auth/google')
      return await authenticateGoogle(request, env);
    if (request.method === 'GET' && path === 'session') {
      const session = await requireSession(request, env);
      const csrfToken = await issueCsrfToken(env, session);
      return json(
        {
          user: {
            id: session.account_id,
            email: session.email,
            name: session.display_name,
          },
          accountId: session.account_id,
          csrfToken,
        },
        200,
        responseHeaders(session)
      );
    }
    if (request.method === 'POST' && path === 'logout')
      return await handleLogout(request, env);
    if (request.method === 'GET' && path === 'sync')
      return await handleSyncGet(request, env);
    if (request.method === 'PUT' && path === 'sync')
      return await handleSyncPut(request, env);
    if (request.method === 'GET' && path === 'sync/revisions')
      return await handleRevisions(request, env);
    if (request.method === 'GET' && path.startsWith('sync/revisions/'))
      return await handleRevisions(request, env, path.split('/').pop());
    if (request.method === 'POST' && path === 'probe')
      return await handleProbe(request, env);
    if (request.method === 'DELETE' && path === 'account')
      return await handleDeleteAccount(request, env);
    return errorResponse(404, 'NOT_FOUND', 'API route not found.');
  } catch (error) {
    if (error instanceof Response) return error;
    if (error?.message === 'PAYLOAD_TOO_LARGE')
      return errorResponse(
        413,
        'PAYLOAD_TOO_LARGE',
        'Request body is too large.'
      );
    if (error?.message === 'INVALID_JSON')
      return errorResponse(
        422,
        'INVALID_JSON',
        'Request body must be valid JSON.'
      );
    return errorResponse(500, 'INTERNAL_ERROR', 'An internal error occurred.');
  }
}

export default { handleApiRequest };

export const apiInternals = { validateEnvelope, parseEtag };
