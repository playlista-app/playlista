const test = require('node:test');
const assert = require('node:assert/strict');
const { downloadableAssets, findRelease } = require('../scripts/publish-downloads');
const { siteFiles, prepareSiteFiles } = require('../scripts/publish-site');

const release = () => ({ tag_name: 'v1.2.3', draft: true, assets: ['windows-x64-setup.exe', 'windows-x64-portable.exe', 'mac-arm64.dmg', 'mac-x64.dmg', 'linux-x86_64.AppImage', 'linux-x64.tar.gz'].map((suffix) => ({ name: `Playlista-1.2.3-${suffix}`, size: 100, state: 'uploaded' })).concat([{ name: 'SHA256SUMS.txt', size: 100 }]) });

test('draft releases are resolved by ID instead of the public tag endpoint', () => {
  const data = release();
  const value = findRelease('v1.2.3', {
    run: () => JSON.stringify({ apiUrl: 'https://api.github.com/repos/playlista-app/playlista/releases/123' }),
    read: (method, endpoint) => { assert.equal(method, 'GET'); assert.equal(endpoint, 'repos/playlista-app/playlista/releases/123'); return data; },
  });
  assert.equal(value.draft, true);
  assert.throws(() => findRelease('v1.2.3', { run: () => JSON.stringify({ apiUrl: 'https://api.github.com/repos/other/repo/releases/123' }) }), /Unexpected/);
});

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

test('automatic and manual deployments prepare the same managed site and preserve a release snapshot offline', async () => {
  const files = await prepareSiteFiles({ refreshRelease: false });
  const marker = JSON.parse(files.find((item) => item.path === '.playlista-site.json').content.toString('utf8'));
  assert.equal(marker.generator, 'playlista/website');
  assert.ok(marker.files.includes('assets/playlist.webp'));
  assert.ok(marker.files.includes('releases.json'));
  assert.ok(marker.files.includes('README.md'));
  assert.equal(new Set(files.map((item) => item.path)).size, files.length);
  assert.ok(JSON.parse(files.find((item) => item.path === 'releases.json').content.toString('utf8')).assets.length > 0);
  assert.equal(files.some((item) => item.path.startsWith('data/')), false);
});
