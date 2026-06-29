import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const outDir = await mkdtemp(join(tmpdir(), 'novelsync-session-restore-'));
const outfile = join(outDir, 'sessionRestore.mjs');

await build({
  entryPoints: ['src/store/sessionRestore.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['axios'],
});

const mod = await import(pathToFileURL(outfile).href);

assert.equal(mod.shouldClearStoredSession({ code: 401, message: '本地会话已过期，请重新登录' }), true);
assert.equal(mod.shouldClearStoredSession({ code: 401, message: '无本地登录态' }), true);
assert.equal(mod.shouldClearStoredSession({ code: 503, message: '会话校验暂时不可用，请稍后重试' }), false);
assert.equal(mod.shouldClearStoredSession({ code: 500, message: '恢复会话异常' }), false);

let attempts = 0;
const ready = await mod.waitForLocalApi(async () => {
  attempts += 1;
  if (attempts < 3) {
    throw new Error('not ready');
  }
}, {
  timeoutMs: 200,
  intervalMs: 1,
  now: () => attempts,
  delay: async () => {},
});
assert.equal(ready, true);
assert.equal(attempts, 3);

let failedAttempts = 0;
const unavailable = await mod.waitForLocalApi(async () => {
  failedAttempts += 1;
  throw new Error('still down');
}, {
  timeoutMs: 3,
  intervalMs: 1,
  now: () => failedAttempts,
  delay: async () => {},
});
assert.equal(unavailable, false);
assert.equal(failedAttempts, 3);

await writeFile(join(outDir, 'ok'), 'ok');
