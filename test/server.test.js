const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('the local API exposes sync status, migrates old settings and closes its server', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-api-'));
  const libraryDirectory = path.join(directory, 'library');
  await fs.mkdir(libraryDirectory);
  const overrides = {
    PLAYLISTA_PLAYLISTS_DIR: libraryDirectory,
    PLAYLISTA_SETTINGS_FILE: path.join(directory, 'settings.json'),
    PLAYLISTA_TAG_METADATA_FILE: path.join(directory, 'tags.json'),
  };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  await fs.writeFile(overrides.PLAYLISTA_SETTINGS_FILE, JSON.stringify({ playlistDirectory: libraryDirectory, github: { folder: 'playlists' }, syncBase: {} }));
  let server;
  try {
    const running = await require('../src/server').startServer({ port: 0 });
    server = running.server;
    const base = `http://127.0.0.1:${running.address.port}`;
    const get = async (url) => {
      const response = await fetch(base + url);
      assert.equal(response.status, 200);
      return response.json();
    };
    const post = async (url, body) => {
      const response = await fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      assert.ok(response.ok, JSON.stringify(result));
      return result;
    };
    const settings = await get('/api/settings');
    assert.equal(settings.github.autoSync, false);
    assert.equal(Object.hasOwn(settings.github, 'folder'), false);
    const created = await post('/api/playlists', { name: 'Punk' });
    const status = await get('/api/github/status');
    assert.equal(status.pendingFiles, 1);
    assert.equal(status.files[0].changes, 1);
    assert.equal(status.configured, false);
    await post('/api/songs', { file: created.file, artist: 'Sum 41', title: 'In Too Deep' });
    const library = await get('/api/library');
    assert.equal(library.playlists[0].songs[0].title, 'In Too Deep');
    assert.equal(library.sync.pendingFiles, 1);
    assert.equal((await get('/api/health')).online, true);
    assert.equal((await get('/api/spotify/status')).connected, false);
    await post('/api/settings', { ...settings, github: { ...settings.github, autoSync: false } });
    const persisted = JSON.parse(await fs.readFile(overrides.PLAYLISTA_SETTINGS_FILE, 'utf8'));
    assert.equal(Object.hasOwn(persisted.github, 'folder'), false);
    assert.equal(Object.hasOwn(persisted, 'syncBase'), false);
    const html = await fetch(base).then((response) => response.text());
    assert.match(html, /githubAutoSyncInput/);
    assert.match(html, /spotifyClientIdInput/);
    assert.doesNotMatch(html, /githubFolderInput/);
  } finally {
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      assert.equal(server.address(), null);
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('playlista-api-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
