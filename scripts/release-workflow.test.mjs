import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/release.yml', 'utf-8');
const syncCommand = 'node scripts/sync-release-version.mjs --tag "${{ github.ref_name }}"';
const checkCommand = 'node scripts/sync-release-version.mjs --tag "${{ github.ref_name }}" --check';
const downloadLatestJsonCommand = 'gh release download "${{ github.ref_name }}" --pattern latest.json --clobber';
const verifyLatestJsonCommand = 'node scripts/verify-latest-json.mjs --file latest.json --tag "${{ github.ref_name }}"';
const copyGhfastManifestCommand = 'cp latest.json latest-ghfast.json';
const rewriteLatestJsonCommand = 'node scripts/rewrite-latest-json-urls.mjs --input latest.json --output latest.json --proxy https://gh-proxy.com/';
const rewriteGhfastJsonCommand = 'node scripts/rewrite-latest-json-urls.mjs --input latest-ghfast.json --output latest-ghfast.json --proxy https://ghfast.top/';
const verifyProxiedLatestJsonCommand = 'node scripts/verify-latest-json.mjs --file latest.json --tag "${{ github.ref_name }}" --require-url-prefix https://gh-proxy.com/https://github.com/';
const verifyGhfastJsonCommand = 'node scripts/verify-latest-json.mjs --file latest-ghfast.json --tag "${{ github.ref_name }}" --require-url-prefix https://ghfast.top/https://github.com/';
const uploadLatestJsonCommand = 'gh release upload "${{ github.ref_name }}" latest.json latest-ghfast.json --clobber';

assert.match(workflow, /name:\s*Sync release version from tag/);
assert.ok(workflow.includes(syncCommand), 'release workflow must sync app version from the pushed tag before packaging');
assert.ok(workflow.includes(checkCommand), 'release workflow must verify app version matches the pushed tag before packaging');
assert.match(workflow, /name:\s*Validate updater signing secrets/);
assert.match(workflow, /TAURI_PRIVATE_KEY:\s*\$\{\{\s*secrets\.TAURI_PRIVATE_KEY\s*\}\}/);
assert.match(workflow, /TAURI_KEY_PASSWORD:\s*\$\{\{\s*secrets\.TAURI_KEY_PASSWORD\s*\}\}/);
assert.ok(
  workflow.indexOf(syncCommand) < workflow.indexOf('uses: tauri-apps/tauri-action@v0'),
  'release version must be synced before tauri-action builds update artifacts',
);
assert.match(workflow, /verify-update-metadata:/);
assert.match(workflow, /needs:\s*build-tauri/);
assert.ok(workflow.includes(downloadLatestJsonCommand), 'release workflow must download the published latest.json after all platform builds');
assert.ok(workflow.includes(verifyLatestJsonCommand), 'release workflow must verify the generated latest.json before rewriting it');
assert.ok(workflow.includes(copyGhfastManifestCommand), 'release workflow must prepare a separate ghfast manifest');
assert.ok(workflow.includes(rewriteLatestJsonCommand), 'release workflow must rewrite GitHub asset URLs through gh-proxy');
assert.ok(workflow.includes(rewriteGhfastJsonCommand), 'release workflow must rewrite GitHub asset URLs through ghfast');
assert.ok(workflow.includes(verifyProxiedLatestJsonCommand), 'release workflow must verify gh-proxy asset URLs before re-uploading latest.json');
assert.ok(workflow.includes(verifyGhfastJsonCommand), 'release workflow must verify ghfast asset URLs before uploading latest-ghfast.json');
assert.ok(workflow.includes(uploadLatestJsonCommand), 'release workflow must overwrite the release latest.json files with proxied manifests');
