const MAX_BODY_BYTES = 1024 * 1024;
const SESSION_DAYS = 30;
const SESSION_ROTATION_DAYS = 7;
const RECENT_AUTH_MINUTES = 10;
const HISTORY_LIMIT = 20;
const HISTORY_RETENTION_DAYS = 30;
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
  const response = await fetch(GOOGLE_JWKS_URL, { cf: { cacheTtl: 3600 } });
  if (!response.ok) throw new Error('GOOGLE_JWKS_UNAVAILABLE');
  const payload = await response.json();
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
    Number(claims.exp) <= nowSeconds() ||
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
    await env.DB.prepare(
      'UPDATE sessions SET token_hash = ?, last_rotated_at = ? WHERE token_hash = ?'
    )
      .bind(await sha256(rotatedToken), nowSeconds(), session.token_hash)
      .run();
    session.token_hash = await sha256(rotatedToken);
    session.setCookie = sessionCookie(
      rotatedToken,
      Math.max(0, Number(session.expires_at) - nowSeconds())
    );
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
    return errorResponse(
      error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 422,
      error.message,
      'Invalid request body.'
    );
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
    return errorResponse(
      error.message === 'PAYLOAD_TOO_LARGE' ? 413 : 422,
      error.message,
      'Invalid sync body.'
    );
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
    await cleanupHistory(env, session.account_id);
  } catch {
    return errorResponse(
      409,
      'SYNC_CONFLICT',
      'The encrypted document has changed.'
    );
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
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(session.token_hash)
    .run();
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
  } catch {
    return errorResponse(422, 'INVALID_BODY', 'Invalid delete request.');
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
      return authenticateGoogle(request, env);
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
      return handleLogout(request, env);
    if (request.method === 'GET' && path === 'sync')
      return handleSyncGet(request, env);
    if (request.method === 'PUT' && path === 'sync')
      return handleSyncPut(request, env);
    if (request.method === 'GET' && path === 'sync/revisions')
      return handleRevisions(request, env);
    if (request.method === 'GET' && path.startsWith('sync/revisions/'))
      return handleRevisions(request, env, path.split('/').pop());
    if (request.method === 'DELETE' && path === 'account')
      return handleDeleteAccount(request, env);
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
