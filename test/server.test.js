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
  await fs.writeFile(overrides.PLAYLISTA_SETTINGS_FILE, JSON.stringify({ playlistDirectory: libraryDirectory, github: { folder: 'playlists' }, syncBase: {}, spotify: { clientId: 'obsolete-client-id' } }));
  let server;
  try {
    const youtube = require('../src/youtube').createYouTubeService({
      credentialFile: path.join(directory, 'youtube.json'),
      bridge: async (input) => {
        if (input.action === 'probe') return { version: 'test' };
        if (input.action === 'connect') return { auth: { cookie: 'test-secret' }, account: { name: 'Personal', handle: '@personal' } };
        if (input.action === 'playlist') return { name: 'YouTube import', description: 'Two duplicate songs', songs: [
          { artist: 'Sum 41', title: 'In Too Deep [Live]' }, { artist: 'Sum 41', title: 'In Too Deep [Live]' },
        ], skipped: 1 };
        throw new Error(`Unexpected ${input.action}`);
      },
    });
    const spotify = require('../src/spotify').createSpotifyService({
      credentialFile: path.join(directory, 'spotify.json'),
      resolveRequest: async () => new Response(null, { status: 302, headers: { location: 'https://open.spotify.com/playlist/0123456789abcdefghijkl' } }),
      bridge: async (input) => {
        if (input.action === 'probe') return { version: 'test' };
        if (input.action === 'connect') return { auth: { cookies: { sp_dc: 'spotify-test-secret' } }, account: { id: 'personal', name: 'Personal Spotify' } };
        if (input.action === 'playlists') return [{ id: '0123456789abcdefghijkl', name: 'Followed', importable: true }];
        if (input.action === 'playlist') return { name: 'Spotify import', description: 'Followed playlist', songs: [
          { artist: 'Green Day', title: 'Basket Case [Live]' }, { artist: 'Green Day', title: 'Basket Case [Live]' },
        ], skipped: 1 };
        throw new Error(`Unexpected ${input.action}`);
      },
    });
    const running = await require('../src/server').startServer({ port: 0, youtube, spotify });
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
    assert.equal(Object.hasOwn(settings, 'spotify'), false);
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
    assert.equal((await get('/api/youtube/status')).connected, false);
    const rejectedOrigin = await fetch(base + '/api/youtube/connect', { method: 'POST', headers: {
      origin: 'https://unrelated.example', 'content-type': 'application/json',
    }, body: JSON.stringify({ headers: 'synthetic' }) });
    assert.equal(rejectedOrigin.status, 403);
    const preview = await post('/api/youtube/connect', { headers: 'synthetic' });
    assert.equal(preview.account.name, 'Personal');
    assert.equal(JSON.stringify(preview).includes('test-secret'), false);
    await post('/api/youtube/accept', { token: preview.token, remember: false });
    const imported = await post('/api/youtube/import', { id: 'https://youtu.be/abcdefghijk?list=PLtest' });
    assert.equal(imported.imported, 2);
    assert.equal(imported.skipped, 1);
    const importedSongs = imported.library.playlists.find((p) => p.id === imported.file).songs;
    assert.deepEqual(importedSongs.map((song) => song.title), ['In Too Deep [Live]', 'In Too Deep [Live]']);
    const text = await fs.readFile(path.join(libraryDirectory, imported.file), 'utf8');
    assert.match(text, /description: Two duplicate songs/);
    assert.doesNotMatch(text, /test-secret|videoId|cookie/);
    await post('/api/youtube/import', { id: 'PLtest', file: imported.file });
    assert.equal((await get('/api/library')).playlists.find((p) => p.id === imported.file).songs.length, 4);
    const spotifyPreview = await post('/api/spotify/connect', { cookies: 'synthetic' });
    assert.equal(spotifyPreview.account.id, 'personal');
    assert.equal((await get('/api/spotify/status')).connected, false);
    assert.doesNotMatch(JSON.stringify(spotifyPreview), /spotify-test-secret|sp_dc/);
    await post('/api/spotify/accept', { token: spotifyPreview.token, remember: false });
    assert.equal((await get('/api/spotify/playlists')).playlists[0].importable, true);
    const spotifyImport = await post('/api/spotify/import', { id: 'open.spotify.com/playlist/0123456789abcdefghijkl' });
    assert.equal(spotifyImport.imported, 2);
    const spotifyText = await fs.readFile(path.join(libraryDirectory, spotifyImport.file), 'utf8');
    assert.doesNotMatch(spotifyText, /sp_dc|spotify-test-secret/);
    assert.match(spotifyText, /"Basket Case \[Live\]"/);
    const appendedShare = await post('/api/spotify/import', { id: 'https://spotify.link/example', file: spotifyImport.file });
    assert.equal(appendedShare.library.playlists.find((p) => p.id === spotifyImport.file).songs.length, 4);
    assert.equal((await get('/api/github/status')).files.find((item) => item.file === spotifyImport.file).status, 'local-only');
    await post('/api/spotify/disconnect', {});
    assert.equal((await get('/api/spotify/status')).connected, false);
    assert.equal((await fetch(base + '/spotify/callback')).status, 404);
    const saved = await post('/api/settings', { ...settings, github: { ...settings.github, autoSync: false } });
    assert.equal(Object.hasOwn(saved.settings, 'spotify'), false);
    const persisted = JSON.parse(await fs.readFile(overrides.PLAYLISTA_SETTINGS_FILE, 'utf8'));
    assert.equal(Object.hasOwn(persisted.github, 'folder'), false);
    assert.equal(Object.hasOwn(persisted, 'syncBase'), false);
    assert.equal(Object.hasOwn(persisted, 'spotify'), false);
    const html = await fetch(base).then((response) => response.text());
    assert.match(html, /githubAutoSyncInput/);
    assert.match(html, /spotifyCookiesInput/);
    assert.doesNotMatch(html, /spotifyClientIdInput|spotifyRedirectUri|Spotify Developer Dashboard/);
    assert.match(html, /youtubeExportView/);
    assert.equal((await fetch(base + '/youtube-ui.js')).status, 200);
    assert.equal((await fetch(base + '/youtube-export-ui.js')).status, 200);
    assert.equal((await fetch(base + '/music-import-ui.js')).status, 200);
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
