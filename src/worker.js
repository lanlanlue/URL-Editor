import { handleApiRequest } from './server/api.js';

const APP_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; connect-src 'self' https: http:; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self' https: http:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const LOGIN_CSP =
  "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client; connect-src 'self' https://accounts.google.com https://www.googleapis.com; style-src 'self'; img-src 'self' data: https://*.googleusercontent.com; frame-src https://accounts.google.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const COMMON_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY',
};

export function isApiRequest(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export function getSpaFallback(pathname) {
  if (pathname === '/' || pathname === '/app' || pathname === '/app/') {
    return { assetPath: '/index.html', csp: APP_CSP };
  }
  if (pathname === '/login' || pathname === '/login/') {
    return { assetPath: '/login.html', csp: LOGIN_CSP };
  }
  return null;
}

function createAssetRequest(request, assetPath) {
  const requestUrl = new URL(request.url);
  const assetUrl = new URL(assetPath, requestUrl);
  assetUrl.search = requestUrl.search;
  return new Request(assetUrl.toString(), {
    method: request.method,
    headers: request.headers,
  });
}

function applySecurityHeaders(response, contentSecurityPolicy) {
  const headers = new Headers(response.headers);
  Object.entries(COMMON_SECURITY_HEADERS).forEach(([name, value]) => {
    headers.set(name, value);
  });
  if (contentSecurityPolicy) {
    headers.set('Content-Security-Policy', contentSecurityPolicy);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (isApiRequest(url.pathname)) {
      const response = await handleApiRequest(request, env);
      return applySecurityHeaders(response);
    }

    const fallback =
      request.method === 'GET' || request.method === 'HEAD'
        ? getSpaFallback(url.pathname)
        : null;
    const assetRequest = fallback
      ? createAssetRequest(request, fallback.assetPath)
      : request;
    const response = await env.ASSETS.fetch(assetRequest);
    return applySecurityHeaders(response, fallback?.csp);
  },
};

export const workerInternals = { getSpaFallback, isApiRequest };
