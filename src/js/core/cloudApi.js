const API_PREFIX = '/api';

export class CloudApiError extends Error {
  constructor(message, { status = 0, code = 'CLOUD_API_ERROR', details } = {}) {
    super(message);
    this.name = 'CloudApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${API_PREFIX}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new CloudApiError(
      payload?.error || `Cloud API request failed (${response.status}).`,
      {
        status: response.status,
        code: payload?.code || 'CLOUD_API_ERROR',
        details: payload,
      }
    );
  }
  return { payload, response };
}

export async function getSession() {
  try {
    const { payload } = await request('/session');
    return payload;
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}

export async function getOAuthCsrfToken() {
  const { payload } = await request('/auth/csrf');
  return payload.csrfToken;
}

export async function getPublicConfig() {
  const { payload } = await request('/config');
  return payload;
}

export async function authenticateGoogle(credential, oauthCsrfToken) {
  const { payload } = await request('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential, csrfToken: oauthCsrfToken }),
  });
  return payload;
}

export async function logout(csrfToken) {
  return request('/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
    body: '{}',
  });
}

export async function getSyncDocument(csrfToken) {
  const { payload, response } = await request('/sync', {
    headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
  });
  return {
    ...payload,
    etag: response.headers.get('ETag') || payload.etag || '"rev-0"',
  };
}

export async function putSyncDocument(envelope, csrfToken, etag = '"rev-0"') {
  const { payload, response } = await request('/sync', {
    method: 'PUT',
    headers: {
      'X-CSRF-Token': csrfToken,
      'If-Match': etag,
    },
    body: JSON.stringify(envelope),
  });
  return {
    ...payload,
    etag: response.headers.get('ETag') || payload.etag,
  };
}

export async function listSyncRevisions(csrfToken) {
  const { payload } = await request('/sync/revisions', {
    headers: { 'X-CSRF-Token': csrfToken },
  });
  return payload.revisions || [];
}

export async function getSyncRevision(revision, csrfToken) {
  const { payload } = await request(
    `/sync/revisions/${encodeURIComponent(revision)}`,
    {
      headers: { 'X-CSRF-Token': csrfToken },
    }
  );
  return payload.envelope;
}

export async function deleteAccount(csrfToken, confirmation) {
  return request('/account', {
    method: 'DELETE',
    headers: { 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ confirmation }),
  });
}

export default {
  getSession,
  getOAuthCsrfToken,
  getPublicConfig,
  authenticateGoogle,
  logout,
  getSyncDocument,
  putSyncDocument,
  listSyncRevisions,
  getSyncRevision,
  deleteAccount,
};
