import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const scriptPath = fileURLToPath(import.meta.url);
const mode = process.argv[2] || 'cloud';
const ignoredDirectories = new Set([
  '.git',
  '.parcel-cache',
  '.wrangler',
  'coverage',
  'dist-extension',
  'node_modules',
]);
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.map',
  '.json',
  '.md',
  '.mjs',
  '.sql',
  '.toml',
  '.ts',
  '.txt',
  '.yml',
]);
const secretPatterns = [
  ['private key material', /-----BEGIN [^-]+ PRIVATE KEY-----/],
  ['Google API key', /AIza[0-9A-Za-z_-]{20,}/],
  ['GitHub access token', /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/],
  [
    'literal Recovery Key',
    /URE1-(?:[A-Za-z0-9_-]{8}-){5,}[A-Za-z0-9_-]+-[A-Z0-9]{4}/,
  ],
];

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(fullPath));
    else if (textExtensions.has(entry.name.slice(entry.name.lastIndexOf('.'))))
      files.push(fullPath);
  }
  return files;
}

function displayPath(path) {
  return relative(projectRoot, path).replaceAll('\\', '/');
}

function fail(message) {
  console.error(`Security check failed: ${message}`);
  process.exitCode = 1;
}

if (!['local', 'cloud'].includes(mode)) {
  fail(`expected mode "local" or "cloud", received "${mode}"`);
}

for (const entry of readdirSync(projectRoot)) {
  if (
    (entry === '.env' || entry.startsWith('.env.')) &&
    entry !== '.env.example'
  )
    fail(`local secret file exists: ${entry}`);
  if (
    (entry === '.dev.vars' || entry.startsWith('.dev.vars.')) &&
    entry !== '.dev.vars.example'
  )
    fail(`local secret file exists: ${entry}`);
}
if (existsSync(join(projectRoot, '.wrangler')))
  fail('local deployment state path exists: .wrangler');

const files = collectFiles(projectRoot).filter((path) => path !== scriptPath);
for (const path of files) {
  let content;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) fail(`${label} found in ${displayPath(path)}`);
  }
}

const distPath = join(projectRoot, 'dist');
if (!existsSync(distPath)) {
  fail('dist does not exist; run a production build first');
} else {
  const distFiles = collectFiles(distPath);
  const htmlFiles = distFiles.filter((path) => path.endsWith('.html'));
  for (const path of htmlFiles) {
    const html = readFileSync(path, 'utf8');
    if (/<script\b[^>]*\bsrc=["']https?:\/\//i.test(html))
      fail(`external script tag found in ${displayPath(path)}`);
  }

  const distNames = distFiles.map((path) => path.slice(distPath.length + 1));
  const hasCloudChunk = distNames.some((name) =>
    /^cloudSyncModal\.[^/]+\.js$/.test(name)
  );
  const hasLoginPage = distNames.includes('login.html');
  const deployableText = distFiles
    .filter((path) => /\.(?:css|html|js)$/.test(path))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  if (mode === 'local') {
    if (hasLoginPage) fail('local build contains login.html');
    if (hasCloudChunk) fail('local build contains the cloud sync chunk');
    if (
      /accounts\.google\.com\/gsi\/client|\/api\/auth\/google/.test(
        deployableText
      )
    )
      fail('local build contains Google OAuth code');
  } else {
    if (!hasLoginPage) fail('cloud build is missing login.html');
    if (!hasCloudChunk) fail('cloud build is missing the cloud sync chunk');
  }
}

if (!process.exitCode) console.log(`Security checks passed (${mode} build).`);
