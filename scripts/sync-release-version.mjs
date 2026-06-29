import { access, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function normalizePath(path) {
  return path.split('\\').join('/');
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf-8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function updateCargoPackageVersion(content, version) {
  const next = content.replace(
    /(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`,
  );

  if (next === content) {
    throw new Error('src-tauri/Cargo.toml is missing [package] version');
  }

  return next;
}

function readCargoPackageVersion(content) {
  return content.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

function updateEnvVersion(content, version) {
  if (/^APP_VERSION=/m.test(content)) {
    return content.replace(/^APP_VERSION=.*$/m, `APP_VERSION=${version}`);
  }

  const suffix = content.endsWith('\n') ? '' : '\n';
  return `${content}${suffix}APP_VERSION=${version}\n`;
}

export function parseReleaseVersion(tag) {
  const rawTag = String(tag ?? '').trim();
  const match = rawTag.match(/^v?(\d+\.\d+\.\d+)$/);

  if (!match) {
    throw new Error(`Invalid release tag "${rawTag}"; expected vX.Y.Z or X.Y.Z`);
  }

  return match[1];
}

export async function syncReleaseVersion({ rootDir = process.cwd(), tag }) {
  const version = parseReleaseVersion(tag);
  const root = resolve(rootDir);

  const tauriConfPath = join(root, 'src-tauri', 'tauri.conf.json');
  const tauriConf = await readJson(tauriConfPath);
  tauriConf.package = tauriConf.package ?? {};
  tauriConf.package.version = version;
  await writeJson(tauriConfPath, tauriConf);

  const cargoTomlPath = join(root, 'src-tauri', 'Cargo.toml');
  const cargoToml = await readFile(cargoTomlPath, 'utf-8');
  await writeFile(cargoTomlPath, updateCargoPackageVersion(cargoToml, version));

  const packageJsonPath = join(root, 'package.json');
  const packageJson = await readJson(packageJsonPath);
  packageJson.version = version;
  await writeJson(packageJsonPath, packageJson);

  const packageLockPath = join(root, 'package-lock.json');
  if (await fileExists(packageLockPath)) {
    const packageLock = await readJson(packageLockPath);
    packageLock.version = version;
    if (packageLock.packages?.['']) {
      packageLock.packages[''].version = version;
    }
    await writeJson(packageLockPath, packageLock);
  }

  for (const envFile of ['.env.production', '.env.development']) {
    const envPath = join(root, envFile);
    if (await fileExists(envPath)) {
      const envContent = await readFile(envPath, 'utf-8');
      await writeFile(envPath, updateEnvVersion(envContent, version));
    }
  }

  return version;
}

export async function assertReleaseVersion({ rootDir = process.cwd(), tag }) {
  const version = parseReleaseVersion(tag);
  const root = resolve(rootDir);
  const failures = [];

  const tauriConfPath = join(root, 'src-tauri', 'tauri.conf.json');
  const tauriConf = await readJson(tauriConfPath);
  if (tauriConf.package?.version !== version) {
    failures.push(`src-tauri/tauri.conf.json package.version is ${tauriConf.package?.version ?? '<missing>'}, expected ${version}`);
  }

  const cargoTomlPath = join(root, 'src-tauri', 'Cargo.toml');
  const cargoVersion = readCargoPackageVersion(await readFile(cargoTomlPath, 'utf-8'));
  if (cargoVersion !== version) {
    failures.push(`src-tauri/Cargo.toml package.version is ${cargoVersion ?? '<missing>'}, expected ${version}`);
  }

  const packageJsonPath = join(root, 'package.json');
  const packageJson = await readJson(packageJsonPath);
  if (packageJson.version !== version) {
    failures.push(`package.json version is ${packageJson.version ?? '<missing>'}, expected ${version}`);
  }

  const packageLockPath = join(root, 'package-lock.json');
  if (await fileExists(packageLockPath)) {
    const packageLock = await readJson(packageLockPath);
    if (packageLock.version !== version) {
      failures.push(`package-lock.json version is ${packageLock.version ?? '<missing>'}, expected ${version}`);
    }
    if (packageLock.packages?.['']?.version !== version) {
      failures.push(`package-lock.json packages[""].version is ${packageLock.packages?.['']?.version ?? '<missing>'}, expected ${version}`);
    }
  }

  for (const envFile of ['.env.production', '.env.development']) {
    const envPath = join(root, envFile);
    if (await fileExists(envPath)) {
      const envContent = await readFile(envPath, 'utf-8');
      const envVersion = envContent.match(/^APP_VERSION=(.*)$/m)?.[1] ?? null;
      if (envVersion !== version) {
        failures.push(`${envFile} APP_VERSION is ${envVersion ?? '<missing>'}, expected ${version}`);
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }

  return version;
}

function parseArgs(argv) {
  const args = {
    check: false,
    rootDir: process.cwd(),
    tag: process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF?.replace(/^refs\/tags\//, ''),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      args.check = true;
    } else if (arg === '--root') {
      args.rootDir = argv[index + 1];
      index += 1;
    } else if (arg === '--tag') {
      args.tag = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.tag) {
    throw new Error('Missing release tag. Pass --tag vX.Y.Z or set GITHUB_REF_NAME.');
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = args.check
    ? await assertReleaseVersion(args)
    : await syncReleaseVersion(args);

  const action = args.check ? 'Verified' : 'Synced';
  console.log(`${action} release version ${version} in ${normalizePath(resolve(args.rootDir))}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
