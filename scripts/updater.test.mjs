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

assert.deepEqual(
  mod.getStartupUpdateDialog({
    status: 'available',
    message: '发现新版本 0.4.4',
    manifest: {
      version: '0.4.4',
      body: '修复自动更新下载地址',
    },
  }),
  {
    kind: 'confirm',
    title: '发现新版本 0.4.4',
    content: '修复自动更新下载地址',
    installable: true,
  },
);

assert.deepEqual(
  mod.getStartupUpdateDialog({
    status: 'up-to-date',
    message: '当前已是最新版本',
  }),
  {
    kind: 'info',
    title: '当前已是最新版本',
    content: '当前已是最新版本',
    installable: false,
  },
);

assert.deepEqual(
  mod.getStartupUpdateDialog({
    status: 'error',
    message: '检查更新失败：Could not fetch a valid release JSON from the remote',
  }),
  {
    kind: 'warning',
    title: '检查更新失败',
    content: '检查更新失败：Could not fetch a valid release JSON from the remote',
    installable: false,
  },
);

const flowEvents = [];
await mod.runStartupUpdateFlow({
  checkForUpdate: async () => ({
    status: 'up-to-date',
    message: '当前已是最新版本',
  }),
  installAvailableUpdate: async () => {
    throw new Error('install should not run when app is up to date');
  },
  showDialog: (dialog) => {
    flowEvents.push(['dialog', dialog.kind, dialog.title, dialog.content, dialog.closable]);
  },
  closeDialog: () => {
    flowEvents.push(['close']);
  },
  sleep: async (ms) => {
    flowEvents.push(['sleep', ms]);
  },
  autoCloseMs: 1200,
});

assert.deepEqual(flowEvents, [
  ['dialog', 'checking', '软件更新检查', '正在检查更新...', false],
  ['dialog', 'up-to-date', '软件更新检查', '当前已是最新版，无需更新。', false],
  ['sleep', 1200],
  ['close'],
]);

const failedFlowEvents = [];
await mod.runStartupUpdateFlow({
  checkForUpdate: async () => ({
    status: 'error',
    message: '检查更新失败：network timeout',
  }),
  installAvailableUpdate: async () => {
    throw new Error('install should not run when update check fails');
  },
  showDialog: (dialog) => {
    failedFlowEvents.push(['dialog', dialog.kind, dialog.title, dialog.content, dialog.closable]);
  },
  closeDialog: () => {
    failedFlowEvents.push(['close']);
  },
  sleep: async () => {
    failedFlowEvents.push(['sleep']);
  },
});

assert.deepEqual(failedFlowEvents, [
  ['dialog', 'checking', '软件更新检查', '正在检查更新...', false],
  [
    'dialog',
    'error',
    '软件更新检查失败',
    '检查更新失败：network timeout\n请前往“设置 > 软件更新”手动检查更新。',
    true,
  ],
]);

const availableFlowEvents = [];
let autoInstalled = false;
await mod.runStartupUpdateFlow({
  checkForUpdate: async () => ({
    status: 'available',
    message: '发现新版本 0.4.1',
    manifest: {
      version: '0.4.1',
      body: '详见提交记录',
    },
  }),
  installAvailableUpdate: async () => {
    autoInstalled = true;
    return {
      status: 'installed',
      message: '更新已安装',
    };
  },
  showDialog: (dialog) => {
    availableFlowEvents.push(['dialog', dialog.kind, dialog.title, dialog.content, dialog.closable]);
  },
  closeDialog: () => {
    availableFlowEvents.push(['close']);
  },
});

assert.equal(autoInstalled, true);
assert.deepEqual(availableFlowEvents, [
  ['dialog', 'checking', '软件更新检查', '正在检查更新...', false],
  ['dialog', 'installing', '软件更新检查', '发现新版本 0.4.1，正在下载并安装...', false],
  ['dialog', 'installed', '软件更新检查', '更新已安装，应用将自动重启。', false],
]);
