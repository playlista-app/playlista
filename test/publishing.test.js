const test = require('node:test');
const assert = require('node:assert/strict');
const { downloadableAssets } = require('../scripts/publish-downloads');
const { siteFiles } = require('../scripts/publish-site');

const release = () => ({ tag_name: 'v1.2.3', draft: true, assets: ['windows-x64-setup.exe', 'windows-x64-portable.exe', 'mac-arm64.dmg', 'mac-x64.dmg', 'linux-x64.AppImage', 'linux-x64.tar.gz'].map((suffix) => ({ name: `Playlista-1.2.3-${suffix}`, size: 100, state: 'uploaded' })).concat([{ name: 'SHA256SUMS.txt', size: 100 }]) });

test('public binary publishing requires every platform and the checksum manifest', () => {
  assert.equal(downloadableAssets(release()).length, 7);
  const missingMac = release(); missingMac.assets = missingMac.assets.filter((item) => !item.name.endsWith('mac-arm64.dmg'));
  assert.throws(() => downloadableAssets(missingMac), /missing desktop builds/);
  const noHashes = release(); noHashes.assets.pop();
  assert.throws(() => downloadableAssets(noHashes), /SHA256SUMS/);
  assert.throws(() => downloadableAssets({ ...release(), prerelease: true }), /stable release/);
});

test('public site publishing contains only dedicated website files and sample assets', async () => {
  const files = await siteFiles();
  assert.ok(files.some((item) => item.path === 'index.html'));
  assert.ok(files.some((item) => item.path === 'assets/playlist.webp'));
  assert.ok(files.some((item) => item.path === 'assets/library.webp'));
  assert.equal(files.some((item) => /(^|\/)(playlists|data|\.git|\.venv|src)(\/|$)/.test(item.path)), false);
});
