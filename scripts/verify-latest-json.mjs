import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REQUIRED_PLATFORMS = [
  'darwin-x86_64',
  'darwin-aarch64',
  'windows-x86_64',
];

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

export function parseRequiredVersion(tagOrVersion) {
  const raw = String(tagOrVersion ?? '').trim();
  const match = raw.match(/^v?(\d+\.\d+\.\d+)$/);

  if (!match) {
    throw new Error(`Invalid release version "${raw}"; expected vX.Y.Z or X.Y.Z`);
  }

  return match[1];
}

export function assertLatestJson({
  manifest,
  version,
  requiredPlatforms = DEFAULT_REQUIRED_PLATFORMS,
}) {
  const failures = [];

  if (manifest?.version !== version) {
    failures.push(`latest.json version is ${manifest?.version ?? '<missing>'}, expected ${version}`);
  }

  for (const platform of requiredPlatforms) {
    const entry = manifest?.platforms?.[platform];
    if (!entry) {
      failures.push(`${platform} platform is missing`);
      continue;
    }

    if (!entry.url) {
      failures.push(`${platform} url is missing`);
    }

    if (!entry.signature) {
      failures.push(`${platform} signature is missing`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

async function fetchJsonWithRetry(url, retries, intervalMs) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(intervalMs);
      }
    }
  }

  throw new Error(`Failed to fetch latest.json from ${url}: ${lastError?.message ?? 'unknown error'}`);
}

function parseArgs(argv) {
  const args = {
    file: null,
    intervalMs: 5000,
    retries: 12,
    tag: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF?.replace(/^refs\/tags\//, ''),
    url: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--file') {
      args.file = argv[index + 1];
      index += 1;
    } else if (arg === '--interval-ms') {
      args.intervalMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--retries') {
      args.retries = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--tag') {
      args.tag = argv[index + 1];
      index += 1;
    } else if (arg === '--url') {
      args.url = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.tag) {
    throw new Error('Missing release tag. Pass --tag vX.Y.Z or set GITHUB_REF_NAME.');
  }

  if (!args.file && !args.url) {
    throw new Error('Missing latest.json source. Pass --file or --url.');
  }

  if (args.file && args.url) {
    throw new Error('Pass either --file or --url, not both.');
  }

  if (!Number.isInteger(args.retries) || args.retries < 1) {
    throw new Error('--retries must be a positive integer.');
  }

  if (!Number.isInteger(args.intervalMs) || args.intervalMs < 0) {
    throw new Error('--interval-ms must be a non-negative integer.');
  }

  return args;
}

async function readManifest(args) {
  if (args.file) {
    return JSON.parse(await readFile(resolve(args.file), 'utf-8'));
  }

  return fetchJsonWithRetry(args.url, args.retries, args.intervalMs);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = parseRequiredVersion(args.tag);
  const manifest = await readManifest(args);
  assertLatestJson({ manifest, version });
  console.log(`Verified latest.json for version ${version}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
