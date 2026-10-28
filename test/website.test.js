const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePlaylistText, validateCollection } = require('../src/format');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { detectPlatform, releaseAssets } = require('../website/downloads');

function release() {
  return { tag_name: 'v1.2.3', assets: ['windows-x64-setup.exe', 'windows-x64-portable.exe', 'mac-arm64.dmg', 'mac-x64.dmg', 'linux-x64.AppImage', 'linux-x64.tar.gz'].map((suffix) => {
    const name = `Playlista-1.2.3-${suffix}`;
    return { name, state: 'uploaded', browser_download_url: `https://github.com/playlista-app/playlista/releases/download/v1.2.3/${name}` };
  }) };
}

test('public downloads match real platform assets and never link to foreign or draft assets', () => {
  const data = release();
  assert.deepEqual(Object.keys(releaseAssets(data)), ['windows', 'portable', 'mac-arm64', 'mac-x64', 'linux', 'linux-archive']);
  assert.equal(releaseAssets(data)['mac-arm64'].endsWith('mac-arm64.dmg'), true);
  assert.deepEqual(releaseAssets({ ...data, draft: true }), {});
  assert.deepEqual(releaseAssets({ ...data, prerelease: true }), {});
  assert.deepEqual(releaseAssets({ ...data, tag_name: null }), {});
  const foreign = release();
  foreign.assets[0].browser_download_url = 'https://example.com/malware.exe';
  assert.equal(releaseAssets(foreign).windows, undefined);
  foreign.assets[0].browser_download_url = data.assets[0].browser_download_url.replace('v1.2.3', 'v0.0.1');
  assert.equal(releaseAssets(foreign).windows, undefined);
  foreign.assets[0].browser_download_url = data.assets[0].browser_download_url.replace('/playlista/releases/', '/playlista-app.github.io/releases/');
  assert.equal(releaseAssets(foreign).windows, undefined, 'website repository assets are not app releases');
});

test('platform recommendation stays local and leaves mobile devices and Mac architecture to the user', () => {
  assert.equal(detectPlatform({ platform: 'Win32' }), 'windows');
  assert.equal(detectPlatform({ platform: 'MacIntel' }), 'mac');
  assert.equal(detectPlatform({ platform: 'MacIntel', maxTouchPoints: 5 }), null);
  assert.equal(detectPlatform({ platform: 'Linux x86_64' }), 'linux');
  assert.equal(detectPlatform({ platform: 'Linux armv8', userAgent: 'Android' }), null);
  assert.equal(detectPlatform({ platform: 'Linux', userAgent: 'CrOS' }), null);
  assert.equal(detectPlatform({}), null);
});

test('the downloadable website example follows the actual playlist schema', () => {
  const parsed = parsePlaylistText(readFileSync(path.join(__dirname, '../website/assets/example.lista'), 'utf8'), 'example.lista');
  assert.deepEqual(validateCollection([parsed]), []);
  assert.equal(parsed.playlist.songs.length, 4);
});
