import assert from 'node:assert/strict';

import {
  assertLatestJson,
  parseRequiredVersion,
} from './verify-latest-json.mjs';

const manifest = {
  version: '0.3.10',
  notes: 'release notes',
  pub_date: '2026-06-29T00:00:00.000Z',
  platforms: {
    'darwin-x86_64': {
      signature: 'mac-intel-signature',
      url: 'https://example.com/NovelSync_x64.app.tar.gz',
    },
    'darwin-aarch64': {
      signature: 'mac-arm-signature',
      url: 'https://example.com/NovelSync_aarch64.app.tar.gz',
    },
    'windows-x86_64': {
      signature: 'windows-signature',
      url: 'https://example.com/NovelSync_0.3.10_x64_en-US.msi.zip',
    },
  },
};

assert.equal(parseRequiredVersion('v0.3.10'), '0.3.10');
assert.equal(parseRequiredVersion('0.3.10'), '0.3.10');
assert.throws(() => parseRequiredVersion('release-0.3.10'), /expected vX\.Y\.Z/);

assertLatestJson({ manifest, version: '0.3.10' });

assert.throws(
  () => assertLatestJson({
    manifest: {
      ...manifest,
      version: '0.3.9',
    },
    version: '0.3.10',
  }),
  /latest\.json version is 0\.3\.9, expected 0\.3\.10/,
);

assert.throws(
  () => assertLatestJson({
    manifest: {
      ...manifest,
      platforms: {
        ...manifest.platforms,
        'windows-x86_64': {
          signature: '',
          url: 'https://example.com/NovelSync_0.3.10_x64_en-US.msi.zip',
        },
      },
    },
    version: '0.3.10',
  }),
  /windows-x86_64 signature is missing/,
);

assert.throws(
  () => assertLatestJson({
    manifest: {
      ...manifest,
      platforms: {
        'darwin-x86_64': manifest.platforms['darwin-x86_64'],
        'darwin-aarch64': manifest.platforms['darwin-aarch64'],
      },
    },
    version: '0.3.10',
  }),
  /windows-x86_64 platform is missing/,
);
