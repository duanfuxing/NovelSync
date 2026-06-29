import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/release.yml', 'utf-8');
const syncCommand = 'node scripts/sync-release-version.mjs --tag "${{ github.ref_name }}"';
const checkCommand = 'node scripts/sync-release-version.mjs --tag "${{ github.ref_name }}" --check';
const latestJsonCommand = 'node scripts/verify-latest-json.mjs --url "https://github.com/${{ github.repository }}/releases/download/${{ github.ref_name }}/latest.json" --tag "${{ github.ref_name }}"';

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
assert.ok(workflow.includes(latestJsonCommand), 'release workflow must verify the published latest.json after all platform builds');
