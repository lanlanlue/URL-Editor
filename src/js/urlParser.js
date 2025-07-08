export function validateUrl(input) {
  try {
    const url = new URL(input);
    return { valid: true, url };
  } catch (e) {
    return { valid: false, error: '無效的 URL 格式' };
  }
}

export function parseUrl(url) {
  return {
    domain: url.hostname,
    path: url.pathname,
    params: Array.from(url.searchParams.entries()), // [['foo', 'bar'], ['id', '123']]
  };
}
