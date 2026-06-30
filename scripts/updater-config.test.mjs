import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MIAOBI_UPDATER_ENDPOINT = 'https://api.miaobi-ai.com/api/novelsync/releases/latest';

const tauriConfig = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf-8'));
const endpoints = tauriConfig?.tauri?.updater?.endpoints;

assert.deepEqual(
  endpoints,
  [MIAOBI_UPDATER_ENDPOINT],
  'Tauri updater must read the release manifest from the Miaobi updater endpoint',
);

for (const endpoint of endpoints ?? []) {
  assert.ok(!endpoint.includes('github.com'), `updater endpoint must not use GitHub directly: ${endpoint}`);
  assert.ok(!endpoint.includes('gh-proxy.com'), `updater endpoint must not use gh-proxy: ${endpoint}`);
  assert.ok(!endpoint.includes('ghfast.top'), `updater endpoint must not use ghfast: ${endpoint}`);
}
