import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertReleaseVersion,
  parseReleaseVersion,
  syncReleaseVersion,
} from './sync-release-version.mjs';

async function writeFixture(rootDir) {
  await mkdir(join(rootDir, 'src-tauri'), { recursive: true });

  await writeFile(join(rootDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({
    package: {
      productName: 'NovelSync',
      version: '0.1.0',
    },
    tauri: {},
  }, null, 2));

  await writeFile(join(rootDir, 'src-tauri', 'Cargo.toml'), [
    '[package]',
    'name = "app"',
    'version = "0.1.0"',
    'description = "NovelSync"',
    '',
    '[dependencies]',
    'tauri = "1.8.1"',
    '',
  ].join('\n'));

  await writeFile(join(rootDir, 'package.json'), JSON.stringify({
    name: 'novel-sync',
    version: '1.0.0',
  }, null, 2));

  await writeFile(join(rootDir, 'package-lock.json'), JSON.stringify({
    name: 'novel-sync',
    version: '1.0.0',
    packages: {
      '': {
        name: 'novel-sync',
        version: '1.0.0',
      },
    },
  }, null, 2));

  await writeFile(join(rootDir, '.env.production'), [
    'API_BASE_URL=https://api.example.com',
    'APP_VERSION=0.1.0',
    '',
  ].join('\n'));

  await writeFile(join(rootDir, '.env.development'), [
    'API_BASE_URL=http://127.0.0.1:18321',
    'APP_VERSION=0.1.0',
    '',
  ].join('\n'));
}

const rootDir = await mkdtemp(join(tmpdir(), 'novelsync-release-version-'));
await writeFixture(rootDir);

assert.equal(parseReleaseVersion('v0.3.10'), '0.3.10');
assert.equal(parseReleaseVersion('0.3.10'), '0.3.10');
assert.throws(() => parseReleaseVersion('release-0.3.10'), /expected vX\.Y\.Z/);

await syncReleaseVersion({ rootDir, tag: 'v0.3.10' });

const tauriConf = JSON.parse(await readFile(join(rootDir, 'src-tauri', 'tauri.conf.json'), 'utf-8'));
assert.equal(tauriConf.package.version, '0.3.10');

const cargoToml = await readFile(join(rootDir, 'src-tauri', 'Cargo.toml'), 'utf-8');
assert.match(cargoToml, /^version = "0\.3\.10"$/m);

const packageJson = JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf-8'));
assert.equal(packageJson.version, '0.3.10');

const packageLock = JSON.parse(await readFile(join(rootDir, 'package-lock.json'), 'utf-8'));
assert.equal(packageLock.version, '0.3.10');
assert.equal(packageLock.packages[''].version, '0.3.10');

const prodEnv = await readFile(join(rootDir, '.env.production'), 'utf-8');
assert.match(prodEnv, /^APP_VERSION=0\.3\.10$/m);

const devEnv = await readFile(join(rootDir, '.env.development'), 'utf-8');
assert.match(devEnv, /^APP_VERSION=0\.3\.10$/m);

await assertReleaseVersion({ rootDir, tag: 'v0.3.10' });

tauriConf.package.version = '0.3.9';
await writeFile(join(rootDir, 'src-tauri', 'tauri.conf.json'), JSON.stringify(tauriConf, null, 2));
await assert.rejects(
  () => assertReleaseVersion({ rootDir, tag: 'v0.3.10' }),
  /src-tauri\/tauri\.conf\.json package\.version is 0\.3\.9, expected 0\.3\.10/,
);
