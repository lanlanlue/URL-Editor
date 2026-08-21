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

/**
 * Extracts all unique domains (host/hostname) and their occurrence count from a list of URL objects.
 * @param {Array<{url: string}>} urls
 * @returns {Array<{domain: string, count: number}>} Sorted by count descending
 */
export function extractDomainsFromUrls(urls = []) {
  const domainCounts = new Map();

  urls.forEach((item) => {
    const urlStr = typeof item === 'string' ? item : item?.url;
    if (!urlStr) return;
    try {
      const parsed = new URL(urlStr);
      // Use host (hostname + port if any)
      const domain = parsed.host;
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    } catch {
      // Ignore invalid URLs
    }
  });

  return Array.from(domainCounts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

/**
 * Replaces the domain/origin of a given URL string if it matches oldDomain.
 * @param {string} urlStr - The full URL string
 * @param {string} oldDomain - Target domain to replace (can be hostname, host:port, or full origin)
 * @param {string} newDomain - Replacement domain (can be hostname, host:port, or full origin)
 * @returns {{ changed: boolean, newUrl: string, oldUrl: string }}
 */
export function replaceUrlDomain(urlStr, oldDomain, newDomain) {
  if (!urlStr || !oldDomain || !newDomain) {
    return { changed: false, newUrl: urlStr, oldUrl: urlStr };
  }

  const cleanOld = oldDomain.trim();
  const cleanNew = newDomain.trim();

  try {
    const url = new URL(urlStr);
    let matched = false;

    // Check if oldDomain is a full URL with protocol
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(cleanOld)) {
      try {
        const oldParsed = new URL(cleanOld);
        if (url.origin.toLowerCase() === oldParsed.origin.toLowerCase()) {
          matched = true;
        }
      } catch {
        matched = false;
      }
    } else {
      // Match by host (including port) or hostname
      const lowerOld = cleanOld.toLowerCase();
      if (
        url.host.toLowerCase() === lowerOld ||
        url.hostname.toLowerCase() === lowerOld
      ) {
        matched = true;
      }
    }

    if (!matched) {
      return { changed: false, newUrl: urlStr, oldUrl: urlStr };
    }

    // Apply new domain
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(cleanNew)) {
      const newParsed = new URL(cleanNew);
      url.protocol = newParsed.protocol;
      url.host = newParsed.host;
    } else {
      // If newDomain has a port like "localhost:8080"
      if (cleanNew.includes(':')) {
        url.host = cleanNew;
      } else {
        url.hostname = cleanNew;
        url.port = ''; // Clear existing port when switching to pure hostname
      }
    }

    const newUrl = url.toString();
    return { changed: newUrl !== urlStr, newUrl, oldUrl: urlStr };
  } catch {
    return { changed: false, newUrl: urlStr, oldUrl: urlStr };
  }
}

/**
 * Replaces occurrences of a substring inside a URL or label.
 * @param {string} text
 * @param {string} findText
 * @param {string} replaceText
 * @param {boolean} matchCase
 * @returns {{ changed: boolean, result: string }}
 */
export function replaceStringContent(
  text,
  findText,
  replaceText = '',
  matchCase = false
) {
  if (typeof text !== 'string' || !findText) {
    return { changed: false, result: text || '' };
  }

  if (matchCase) {
    const changed = text.includes(findText);
    return {
      changed,
      result: changed ? text.replaceAll(findText, replaceText) : text,
    };
  } else {
    const regex = new RegExp(
      findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'gi'
    );
    const changed = regex.test(text);
    return {
      changed,
      result: changed ? text.replace(regex, replaceText) : text,
    };
  }
}

/**
 * Executes a batch preview or update over a collection of URL entries.
 * @param {Array<{id: string, url: string, label: string, tags: Array<string>}>} urls
 * @param {object} options
 * @param {'domain'|'text'} options.type
 * @param {string} [options.oldDomain]
 * @param {string} [options.newDomain]
 * @param {string} [options.findText]
 * @param {string} [options.replaceText]
 * @param {boolean} [options.matchCase]
 * @param {'url'|'label'|'all'} [options.targetField]
 * @param {Set<string>|Array<string>|null} [options.filterIds]
 * @returns {{ updatedUrls: Array<object>, affectedCount: number, previewList: Array<object> }}
 */
export function batchProcessUrls(urls = [], options = {}) {
  const {
    type = 'domain',
    oldDomain = '',
    newDomain = '',
    findText = '',
    replaceText = '',
    matchCase = false,
    targetField = 'all',
    filterIds = null,
  } = options;

  const targetSet = filterIds ? new Set(filterIds) : null;
  let affectedCount = 0;
  const previewList = [];

  const updatedUrls = urls.map((entry) => {
    if (targetSet && !targetSet.has(entry.id)) {
      return { ...entry };
    }

    let urlChanged = false;
    let labelChanged = false;
    let newUrl = entry.url;
    let newLabel = entry.label || '';

    if (type === 'domain') {
      const res = replaceUrlDomain(entry.url, oldDomain, newDomain);
      if (res.changed) {
        urlChanged = true;
        newUrl = res.newUrl;
      }
    } else if (type === 'text') {
      if (targetField === 'url' || targetField === 'all') {
        const res = replaceStringContent(
          entry.url,
          findText,
          replaceText,
          matchCase
        );
        if (res.changed) {
          urlChanged = true;
          newUrl = res.result;
        }
      }
      if (targetField === 'label' || targetField === 'all') {
        const res = replaceStringContent(
          entry.label || '',
          findText,
          replaceText,
          matchCase
        );
        if (res.changed) {
          labelChanged = true;
          newLabel = res.result;
        }
      }
    }

    const changed = urlChanged || labelChanged;
    if (changed) {
      affectedCount++;
    }

    previewList.push({
      id: entry.id,
      changed,
      oldUrl: entry.url,
      newUrl,
      oldLabel: entry.label || '',
      newLabel,
    });

    return {
      ...entry,
      url: newUrl,
      label: newLabel,
    };
  });

  return {
    updatedUrls,
    affectedCount,
    previewList,
  };
}

/**
 * Finds duplicate URL entries in the list.
 * @param {Array<{id: string, url: string}>} urls
 * @returns {{ duplicates: Array<{url: string, count: number, ids: Array<string>}>, totalDuplicates: number }}
 */
export function findDuplicateUrls(urls = []) {
  const urlMap = new Map();

  urls.forEach((entry) => {
    if (!entry || !entry.url) return;
    const norm = entry.url.trim();
    if (!urlMap.has(norm)) {
      urlMap.set(norm, []);
    }
    urlMap.get(norm).push(entry.id);
  });

  const duplicates = [];
  let totalDuplicates = 0;

  urlMap.forEach((ids, url) => {
    if (ids.length > 1) {
      duplicates.push({ url, count: ids.length, ids });
      totalDuplicates += ids.length - 1;
    }
  });

  return {
    duplicates,
    totalDuplicates,
  };
}

/**
 * Analyzes a URL and generates a suggested human-readable label.
 * @param {URL|string} urlInput
 * @param {string} [explicitName='']
 * @returns {string}
 */
export function generateSuggestedLabel(urlInput, explicitName = '') {
  if (explicitName && explicitName.trim()) {
    return explicitName.trim();
  }

  let url;
  try {
    url = typeof urlInput === 'string' ? new URL(urlInput) : urlInput;
  } catch {
    return explicitName || '';
  }

  // 1. Check title/name query parameters
  const nameKeys = ['title', 'name', 'label', 'q', 'query', 'action', 'page'];
  for (const key of nameKeys) {
    if (url.searchParams.has(key)) {
      const val = url.searchParams.get(key)?.trim();
      if (val && val.length < 50) {
        return val;
      }
    }
  }

  // 2. Extract from pathname
  const pathParts = url.pathname
    .split('/')
    .map((p) => decodeURIComponent(p).trim())
    .filter(Boolean);

  if (pathParts.length > 0) {
    // Find the last non-pure-numeric / non-UUID segment, or the last segment
    let meaningfulSegment = pathParts[pathParts.length - 1];
    const isIdOrUuid = /^(\d+|[0-9a-fA-F-]{36}|[0-9a-fA-F]{24})$/.test(
      meaningfulSegment
    );

    if (isIdOrUuid && pathParts.length > 1) {
      meaningfulSegment = `${pathParts[pathParts.length - 2]} ${meaningfulSegment}`;
    }

    // Clean up file extensions like .html, .php, .json
    meaningfulSegment = meaningfulSegment.replace(
      /\.(html?|php|json|action|do)$/i,
      ''
    );

    // Format hyphens/underscores/camelCase into spaces
    const formatted = meaningfulSegment
      .replace(/[-_]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();

    if (formatted) {
      return formatted;
    }
  }

  // 3. Fallback to hostname
  return url.hostname;
}

/**
 * Analyzes a URL and automatically generates suggested category/environment/domain tags.
 * @param {URL|string} urlInput
 * @returns {Array<string>}
 */
export function generateSuggestedTags(urlInput) {
  let url;
  try {
    url = typeof urlInput === 'string' ? new URL(urlInput) : urlInput;
  } catch {
    return [];
  }

  const tags = new Set();
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  // 1. Environment detection
  const envKeywords = [
    { key: 'localhost', tag: 'localhost' },
    { key: 'dev', regex: /(^|\.|\/|-|_)dev($|\.|\/|-|_)/, tag: 'dev' },
    {
      key: 'stage',
      regex: /(^|\.|\/|-|_)(stage|staging)($|\.|\/|-|_)/,
      tag: 'staging',
    },
    { key: 'qa', regex: /(^|\.|\/|-|_)qa($|\.|\/|-|_)/, tag: 'qa' },
    { key: 'uat', regex: /(^|\.|\/|-|_)uat($|\.|\/|-|_)/, tag: 'uat' },
    {
      key: 'prod',
      regex: /(^|\.|\/|-|_)(prod|production)($|\.|\/|-|_)/,
      tag: 'prod',
    },
    { key: 'test', regex: /(^|\.|\/|-|_)test($|\.|\/|-|_)/, tag: 'test' },
  ];

  envKeywords.forEach(({ tag, regex, key }) => {
    if (regex && (regex.test(host) || regex.test(path))) {
      tags.add(tag);
    } else if (!regex && (host.includes(key) || path.includes(key))) {
      tags.add(tag);
    }
  });

  // 2. Main domain / brand detection
  const hostParts = host.split('.');
  if (hostParts.length >= 2) {
    // E.g. "api.github.com" -> "github"
    const domainName = hostParts[hostParts.length - 2];
    if (
      domainName &&
      ![
        'com',
        'org',
        'net',
        'edu',
        'gov',
        'io',
        'me',
        'co',
        'app',
        'dev',
      ].includes(domainName) &&
      domainName.length > 2
    ) {
      tags.add(domainName);
    }
  }

  // 3. API and Path module keywords
  const pathParts = path.split('/').filter(Boolean);
  const commonModuleKeywords = [
    'api',
    'v1',
    'v2',
    'v3',
    'v4',
    'auth',
    'admin',
    'docs',
    'dashboard',
    'user',
    'users',
    'order',
    'orders',
    'payment',
    'settings',
    'webhook',
    'webhooks',
    'login',
    'register',
    'graphql',
    'swagger',
  ];

  pathParts.forEach((part) => {
    if (commonModuleKeywords.includes(part)) {
      tags.add(part);
    }
  });

  // If host starts with api.
  if (host.startsWith('api.')) {
    tags.add('api');
  }

  return Array.from(tags);
}

/**
 * Parses raw text containing one or many URLs (line-by-line, Markdown links, CSV, or freeform text).
 * @param {string} rawText
 * @param {object} options
 * @param {boolean} [options.autoName=true]
 * @param {boolean} [options.autoTag=true]
 * @param {Array<string>} [options.commonTags=[]]
 * @param {Array<{url: string}>} [options.existingUrls=[]]
 * @returns {{ items: Array<{ id: string, url: string, label: string, tags: Array<string>, isExisting: boolean, selected: boolean }>, stats: { totalFound: number, uniqueFound: number, existingCount: number } }}
 */
export function parseBatchUrlText(rawText = '', options = {}) {
  const {
    autoName = true,
    autoTag = true,
    commonTags = [],
    existingUrls = [],
  } = options;

  if (!rawText || !rawText.trim()) {
    return {
      items: [],
      stats: { totalFound: 0, uniqueFound: 0, existingCount: 0 },
    };
  }

  const existingSet = new Set(
    existingUrls.map((entry) =>
      (typeof entry === 'string' ? entry : entry?.url)?.trim()
    )
  );

  const lines = rawText.split(/\r?\n/);
  const foundEntries = [];
  const seenUrlsInBatch = new Set();

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;

    // Check Markdown format: [Label](url)
    const mdMatch = trimmedLine.match(
      /^[-*•]?\s*\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/i
    );
    if (mdMatch) {
      const explicitLabel = mdMatch[1].trim();
      const urlStr = mdMatch[2].trim();
      try {
        const urlObj = new URL(urlStr);
        foundEntries.push({ urlStr: urlObj.toString(), explicitLabel, urlObj });
      } catch {
        // Ignore invalid URL
      }
      return;
    }

    // Check CSV / TSV format: Name, https://...
    const csvMatch = trimmedLine.match(
      /^([^,\t]+)[,\t](https?:\/\/[^\s,\t]+)/i
    );
    if (csvMatch) {
      const explicitLabel = csvMatch[1].trim();
      const urlStr = csvMatch[2].trim();
      try {
        const urlObj = new URL(urlStr);
        foundEntries.push({ urlStr: urlObj.toString(), explicitLabel, urlObj });
      } catch {
        // Ignore invalid URL
      }
      return;
    }

    // Extract any URLs in line using regex
    const urlMatches = trimmedLine.match(/https?:\/\/[^\s<>"'{}|\\^`[\]]+/gi);
    if (urlMatches) {
      urlMatches.forEach((match) => {
        try {
          const cleanMatch = match.replace(/[.,;!?)]+$/, '');
          const urlObj = new URL(cleanMatch);
          foundEntries.push({
            urlStr: urlObj.toString(),
            explicitLabel: '',
            urlObj,
          });
        } catch {
          // Ignore invalid URL
        }
      });
    }
  });

  const items = [];
  let existingCount = 0;

  foundEntries.forEach(({ urlStr, explicitLabel, urlObj }) => {
    if (seenUrlsInBatch.has(urlStr)) return;
    seenUrlsInBatch.add(urlStr);

    const isExisting = existingSet.has(urlStr);
    if (isExisting) {
      existingCount++;
    }

    const label = autoName
      ? generateSuggestedLabel(urlObj, explicitLabel)
      : explicitLabel || '';
    const suggestedTags = autoTag ? generateSuggestedTags(urlObj) : [];
    const combinedTags = Array.from(
      new Set([
        ...suggestedTags,
        ...(commonTags || []).map((t) => t.trim()).filter(Boolean),
      ])
    );

    items.push({
      id: self.crypto?.randomUUID
        ? self.crypto.randomUUID()
        : `import-${Date.now()}-${Math.random()}`,
      url: urlStr,
      label,
      tags: combinedTags,
      isExisting,
      selected: !isExisting, // Default unselect if already existing
    });
  });

  return {
    items,
    stats: {
      totalFound: foundEntries.length,
      uniqueFound: items.length,
      existingCount,
    },
  };
}
