import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const GITHUB_URL_PREFIX = 'https://github.com/';

function normalizeProxyBase(proxyBase) {
  const trimmed = String(proxyBase ?? '').trim();
  if (!trimmed) {
    throw new Error('Missing proxy base URL.');
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function proxyGithubUrl(url, proxyBase) {
  const trimmedUrl = String(url ?? '').trim();
  const normalizedProxyBase = normalizeProxyBase(proxyBase);

  if (!trimmedUrl || trimmedUrl.startsWith(normalizedProxyBase)) {
    return trimmedUrl;
  }

  if (!trimmedUrl.startsWith(GITHUB_URL_PREFIX)) {
    return trimmedUrl;
  }

  return `${normalizedProxyBase}${trimmedUrl}`;
}

export function rewriteLatestJsonUrls(manifest, proxyBase) {
  const rewritten = JSON.parse(JSON.stringify(manifest ?? {}));

  for (const entry of Object.values(rewritten.platforms ?? {})) {
    if (typeof entry?.url === 'string') {
      entry.url = proxyGithubUrl(entry.url, proxyBase);
    }
  }

  return rewritten;
}

function parseArgs(argv) {
  const args = {
    input: null,
    output: null,
    proxy: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      args.input = argv[index + 1];
      index += 1;
    } else if (arg === '--output') {
      args.output = argv[index + 1];
      index += 1;
    } else if (arg === '--proxy') {
      args.proxy = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.input) {
    throw new Error('Missing --input latest.json path.');
  }

  if (!args.output) {
    throw new Error('Missing --output latest.json path.');
  }

  if (!args.proxy) {
    throw new Error('Missing --proxy URL.');
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(resolve(args.input), 'utf-8'));
  const rewritten = rewriteLatestJsonUrls(manifest, args.proxy);

  await writeFile(resolve(args.output), `${JSON.stringify(rewritten, null, 2)}\n`);
  console.log(`Rewrote latest.json asset URLs through ${normalizeProxyBase(args.proxy)}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
