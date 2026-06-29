import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outDir = await mkdtemp(join(tmpdir(), 'novelsync-updater-'));
const outfile = join(outDir, 'updater.mjs');

await build({
  entryPoints: ['src/utils/updater.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
});

const mod = await import(pathToFileURL(outfile).href);

assert.equal(mod.isTauriRuntime({ __TAURI_IPC__: () => {} }), true);
assert.equal(mod.isTauriRuntime({}), false);
assert.equal(mod.isTauriRuntime(undefined), false);

const unsupportedDeps = {
  isTauriRuntime: () => false,
  getVersion: async () => '9.9.9',
  checkUpdate: async () => ({ shouldUpdate: true }),
  installUpdate: async () => {},
};

assert.deepEqual(await mod.getCurrentVersion(unsupportedDeps), {
  isTauri: false,
  version: '开发环境',
});

assert.deepEqual(await mod.checkForUpdate({ deps: unsupportedDeps }), {
  status: 'unsupported',
  message: '当前环境不支持自动更新',
});

let installed = false;
const updateDeps = {
  isTauriRuntime: () => true,
  getVersion: async () => '0.4.0',
  checkUpdate: async () => ({
    shouldUpdate: true,
    manifest: {
      version: '0.4.1',
      date: '2026-06-29T06:34:26.424Z',
      body: '详见提交记录',
    },
  }),
  installUpdate: async () => {
    installed = true;
  },
};

assert.deepEqual(await mod.getCurrentVersion(updateDeps), {
  isTauri: true,
  version: '0.4.0',
});

assert.deepEqual(await mod.checkForUpdate({ deps: updateDeps }), {
  status: 'available',
  message: '发现新版本 0.4.1',
  manifest: {
    version: '0.4.1',
    date: '2026-06-29T06:34:26.424Z',
    body: '详见提交记录',
  },
});

assert.deepEqual(await mod.installAvailableUpdate(updateDeps), {
  status: 'installed',
  message: '更新已安装',
});
assert.equal(installed, true);

const upToDateDeps = {
  ...updateDeps,
  checkUpdate: async () => ({ shouldUpdate: false }),
};

assert.deepEqual(await mod.checkForUpdate({ deps: upToDateDeps }), {
  status: 'up-to-date',
  message: '当前已是最新版本',
});

const failingDeps = {
  ...updateDeps,
  checkUpdate: async () => {
    throw new Error('network timeout');
  },
};

assert.deepEqual(await mod.checkForUpdate({ deps: failingDeps }), {
  status: 'error',
  message: '检查更新失败：network timeout',
});
