import assert from 'node:assert/strict';

import {
  proxyGithubUrl,
  rewriteLatestJsonUrls,
} from './rewrite-latest-json-urls.mjs';

const proxyBase = 'https://gh-proxy.com/';
const githubAssetUrl = 'https://github.com/duanfuxing/NovelSync/releases/download/v0.4.4/NovelSync.app.tar.gz';

assert.equal(
  proxyGithubUrl(githubAssetUrl, proxyBase),
  'https://gh-proxy.com/https://github.com/duanfuxing/NovelSync/releases/download/v0.4.4/NovelSync.app.tar.gz',
);

assert.equal(
  proxyGithubUrl(githubAssetUrl, 'https://ghfast.top'),
  'https://ghfast.top/https://github.com/duanfuxing/NovelSync/releases/download/v0.4.4/NovelSync.app.tar.gz',
);

assert.equal(
  proxyGithubUrl(` ${githubAssetUrl} `, proxyBase),
  'https://gh-proxy.com/https://github.com/duanfuxing/NovelSync/releases/download/v0.4.4/NovelSync.app.tar.gz',
);

assert.equal(
  proxyGithubUrl('https://cdn.example.com/NovelSync.app.tar.gz', proxyBase),
  'https://cdn.example.com/NovelSync.app.tar.gz',
);

assert.equal(
  proxyGithubUrl('https://gh-proxy.com/https://github.com/duanfuxing/NovelSync/releases/download/v0.4.4/NovelSync.app.tar.gz', proxyBase),
  'https://gh-proxy.com/https://github.com/duanfuxing/NovelSync/releases/download/v0.4.4/NovelSync.app.tar.gz',
);

const rewritten = rewriteLatestJsonUrls({
  version: '0.4.4',
  platforms: {
    'darwin-aarch64': {
      signature: 'mac-arm-signature',
      url: githubAssetUrl,
    },
    'windows-x86_64': {
      signature: 'windows-signature',
      url: 'https://github.com/duanfuxing/NovelSync/releases/download/v0.4.4/NovelSync_0.4.4_x64_en-US.msi.zip',
    },
  },
}, proxyBase);

assert.equal(
  rewritten.platforms['darwin-aarch64'].url,
  'https://gh-proxy.com/https://github.com/duanfuxing/NovelSync/releases/download/v0.4.4/NovelSync.app.tar.gz',
);
assert.equal(
  rewritten.platforms['windows-x86_64'].url,
  'https://gh-proxy.com/https://github.com/duanfuxing/NovelSync/releases/download/v0.4.4/NovelSync_0.4.4_x64_en-US.msi.zip',
);
