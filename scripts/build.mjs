import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] || 'runtime';
const isGitHubPagesBuild = process.argv[3] === 'gh';

if (!['runtime', 'local', 'cloud'].includes(mode)) {
  throw new Error(`Unsupported build mode: ${mode}`);
}

const parcelArgs = isGitHubPagesBuild
  ? ['build', 'src/index.html', '--no-cache']
  : ['build', 'src/index.html', 'src/login.html', '--no-cache'];
if (isGitHubPagesBuild) parcelArgs.push('--public-url', '/URL-Editor/');

function runNode(entry, args) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${entry} exited with status ${result.status ?? 1}`);
  }
}

const parcelEntry = fileURLToPath(
  new URL('../node_modules/parcel/lib/bin.js', import.meta.url)
);
const copyfilesEntry = fileURLToPath(
  new URL('../node_modules/copyfiles/copyfiles', import.meta.url)
);

const buildModePath = fileURLToPath(
  new URL('../src/js/core/buildMode.js', import.meta.url)
);
const cloudLoaderPath = fileURLToPath(
  new URL('../src/js/core/cloudFeatureLoader.js', import.meta.url)
);
const distPath = fileURLToPath(new URL('../dist', import.meta.url));
const originalBuildMode = readFileSync(buildModePath, 'utf8');
const originalCloudLoader = readFileSync(cloudLoaderPath, 'utf8');

try {
  rmSync(distPath, { force: true, recursive: true });
  if (mode !== 'runtime') {
    writeFileSync(
      buildModePath,
      `// Temporary build-time value.\nexport const BUILD_MODE = '${mode}';\n`,
      'utf8'
    );
  }
  if (mode === 'local') {
    writeFileSync(
      cloudLoaderPath,
      'export async function loadCloudSyncModule() { return null; }\n',
      'utf8'
    );
  }

  runNode(parcelEntry, parcelArgs);
  runNode(copyfilesEntry, [
    '-u',
    '2',
    'src/static/manifest.json',
    'src/static/_headers',
    'src/static/_redirects',
    'dist',
  ]);
} finally {
  writeFileSync(buildModePath, originalBuildMode, 'utf8');
  writeFileSync(cloudLoaderPath, originalCloudLoader, 'utf8');
}
