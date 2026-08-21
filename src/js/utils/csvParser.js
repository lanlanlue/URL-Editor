/**
 * CSV Parser & Generator supporting RFC 4180 compliant escaping.
 */

/**
 * Escapes a single field value for CSV.
 * @param {string|number|boolean} value
 * @returns {string}
 */
export function escapeCsvField(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts an array of URL entries to a CSV string.
 * @param {Array<object>} urls
 * @returns {string}
 */
export function exportToCsvString(urls = []) {
  const header = ['URL', 'Label', 'Tags', 'UsageCount', 'IsPinned'];
  const rows = [header.join(',')];

  urls.forEach((item) => {
    const tagsStr = Array.isArray(item.tags) ? item.tags.join(';') : '';
    const row = [
      escapeCsvField(item.url || ''),
      escapeCsvField(item.label || ''),
      escapeCsvField(tagsStr),
      escapeCsvField(item.usageCount || 0),
      escapeCsvField(item.isPinned ? 'true' : 'false'),
    ];
    rows.push(row.join(','));
  });

  return rows.join('\r\n');
}

/**
 * Parses a single CSV line accounting for quoted strings.
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Parses CSV text into array of URL objects.
 * @param {string} csvText
 * @returns {Array<object>}
 */
export function parseCsvString(csvText = '') {
  if (!csvText || !csvText.trim()) return [];

  // Split into lines while handling newlines inside quotes
  const rawLines = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      currentLine += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && csvText[i + 1] === '\n') i++;
      if (currentLine.trim()) rawLines.push(currentLine);
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim()) rawLines.push(currentLine);

  if (rawLines.length === 0) return [];

  // Parse header
  const header = parseCsvLine(rawLines[0]).map((h) => h.trim().toLowerCase());
  const urlIdx = header.indexOf('url');
  const labelIdx = header.indexOf('label');
  const tagsIdx = header.indexOf('tags');
  const usageIdx = header.indexOf('usagecount');
  const pinIdx = header.indexOf('ispinned');

  const results = [];

  for (let i = 1; i < rawLines.length; i++) {
    const fields = parseCsvLine(rawLines[i]);
    const rawUrl = urlIdx !== -1 ? fields[urlIdx] : fields[0];
    if (!rawUrl || !rawUrl.trim()) continue;

    const url = rawUrl.trim();
    const label =
      labelIdx !== -1 && fields[labelIdx] ? fields[labelIdx].trim() : '';
    const rawTags =
      tagsIdx !== -1 && fields[tagsIdx] ? fields[tagsIdx].trim() : '';
    const tags = rawTags
      ? rawTags
          .split(/[;,]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const usageCount =
      usageIdx !== -1 && fields[usageIdx]
        ? parseInt(fields[usageIdx], 10) || 0
        : 0;
    const isPinned =
      pinIdx !== -1 && fields[pinIdx]
        ? fields[pinIdx].trim().toLowerCase() === 'true'
        : false;

    results.push({
      url,
      label,
      tags,
      usageCount,
      isPinned,
    });
  }

  return results;
}
