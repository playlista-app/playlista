const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createSpotifyService, playlistId } = require('../src/spotify');
const { pythonExecutable } = require('../src/python-bridge');

const id = '0123456789abcdefghijkl';
const account = { id: 'personal-id', name: 'Personal account' };
const auth = { identifier: account.id, cookies: { sp_dc: 'synthetic-secret' } };

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-spotapi-'));
  const credentialFile = path.join(directory, 'spotify.json');
  const calls = [];
  const imports = [];
  let folder = 'library';
  const bridge = async (input) => {
    calls.push(input);
    if (input.action === 'probe') return { version: '1.2.8' };
    if (input.action === 'connect' || input.action === 'unseal') return { auth, account };
    if (input.action === 'seal') return 'encrypted-synthetic';
    if (input.action === 'playlists') return [{ id, name: 'Followed playlist', importable: true }];
    if (input.action === 'playlist') return { name: 'Remote', description: 'line one\nline two', songs: [
      { artist: 'Sum 41', title: 'In Too Deep' }, { artist: 'Sum 41', title: 'In Too Deep' },
    ], skipped: 2 };
    throw new Error(`Unexpected ${input.action}`);
  };
  const storage = { getPlaylistsDirectory: () => folder, importSongs: async (input) => {
    imports.push(input); return { file: 'remote.lista', imported: input.songs.length };
  }, getLibrary: async () => ({ valid: true, playlists: [{ id: 'punk.lista', name: 'Punk', songs: [
    { title: 'Basket Case' }, { title: 'Basket Case' }, { title: 'Missing' },
  ] }] }) };
  const service = createSpotifyService({ bridge, storage, credentialFile, platform: 'win32', ...overrides });
  t.after(async () => {
    service.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('playlista-spotapi-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  async function connect(remember = false) {
    const preview = await service.previewConnection({ cookies: 'synthetic-secret' });
    await service.acceptConnection({ token: preview.token, remember });
  }
  return { service, bridge, calls, imports, credentialFile, connect, setFolder: (value) => { folder = value; } };
}

test('Spotify account must be confirmed; remembered cookies are encrypted and disconnect deletes them', async (t) => {
  const f = await fixture(t);
  const preview = await f.service.previewConnection({ cookies: 'synthetic-secret' });
  assert.deepEqual(preview.account, account);
  assert.equal((await f.service.status()).connected, false);
  assert.doesNotMatch(JSON.stringify(preview), /synthetic-secret|cookies/);
  await assert.rejects(f.service.getPlaylists(), /Connect Spotify/);
  await assert.rejects(f.service.acceptConnection({ token: 'wrong' }), /expired/);
  await f.service.acceptConnection({ token: preview.token, remember: true });
  const persisted = await fs.readFile(f.credentialFile, 'utf8');
  assert.equal(JSON.parse(persisted).ciphertext, 'encrypted-synthetic');
  assert.doesNotMatch(persisted, /sp_dc|personal-id|synthetic-secret/);
  const restored = createSpotifyService({ bridge: f.bridge, credentialFile: f.credentialFile, platform: 'win32' });
  t.after(() => restored.close());
  assert.deepEqual((await restored.status()).account, account);
  assert.equal((await f.service.status()).provider, 'spotapi');
  await f.service.disconnect();
  await assert.rejects(fs.readFile(f.credentialFile), { code: 'ENOENT' });
  assert.equal((await f.service.status()).connected, false);
});

test('Spotify accepts URLs, URIs and IDs, imports followed playlists and preserves duplicates', async (t) => {
  const f = await fixture(t);
  await f.connect();
  assert.equal((await f.service.getPlaylists())[0].importable, true);
  const imported = await f.service.importPlaylist({ id: `https://open.spotify.com/playlist/${id}?si=test` });
  assert.equal(imported.imported, 2);
  assert.equal(imported.skipped, 2);
  assert.equal(f.imports[0].description, 'line one line two');
  assert.deepEqual(f.imports[0].songs, [{ artist: 'Sum 41', title: 'In Too Deep' }, { artist: 'Sum 41', title: 'In Too Deep' }]);
  await f.service.importPlaylist({ id: `spotify:playlist:${id}`, name: 'Custom', file: 'punk.lista' });
  assert.equal(f.imports[1].file, 'punk.lista');
  assert.equal(f.imports[1].name, 'Custom');
  assert.equal(playlistId(`https://open.spotify.com/intl-sv/playlist/${id}`), id);
  assert.throws(() => playlistId(`https://malicious.example/playlist/${id}`));
  assert.throws(() => playlistId('../secret'));
  await assert.rejects(fs.readFile(f.credentialFile), { code: 'ENOENT' });
});

test('Spotify account previews expire and cookies stay in memory off Windows', async (t) => {
  let time = 1;
  const f = await fixture(t, { platform: 'linux', now: () => time });
  const preview = await f.service.previewConnection({ cookies: 'synthetic-secret' });
  assert.equal(preview.canRemember, false);
  await assert.rejects(f.service.acceptConnection({ token: preview.token, remember: true }), /session-only/);
  time += 6 * 60_000;
  await assert.rejects(f.service.acceptConnection({ token: preview.token }), /expired/);
  await f.connect();
  assert.equal((await f.service.status()).remembered, false);
  await assert.rejects(fs.readFile(f.credentialFile), { code: 'ENOENT' });
});

test('a changed destination or failed remote read never writes a Spotify import', async (t) => {
  let release;
  let began;
  const reading = new Promise((resolve) => { began = resolve; });
  const f = await fixture(t, { bridge: async (input) => {
    if (input.action === 'connect') return { auth, account };
    if (input.action === 'playlist') { began(); return new Promise((resolve) => { release = resolve; }); }
    throw new Error('Unexpected');
  } });
  await f.connect();
  const operation = f.service.importPlaylist({ id });
  await reading;
  await assert.rejects(f.service.disconnect(), /Wait/);
  f.setFolder('another library');
  release({ name: 'Test', songs: [{ title: 'Test' }] });
  await assert.rejects(operation, /folder changed/);
  assert.equal(f.imports.length, 0);
});

test('Spotify export uses first matches, preserves duplicates and reports skipped tracks', async (t) => {
  let sent;
  const f = await fixture(t, { bridge: async (input) => {
    if (input.action === 'connect') return { auth, account };
    if (input.action === 'search_batch') return input.queries.map((query) => ({ query, matches: query === 'Missing' ? [] : [{ id, artist: 'Green Day', title: 'Basket Case' }] }));
    if (input.action === 'create') { sent = input.ids; return { id, added: input.ids.length, complete: true }; }
    throw new Error(`Unexpected ${input.action}`);
  } });
  await f.connect();
  const plan = await f.service.prepareExport({ file: 'punk.lista', automatic: true });
  let result;
  for (let index = 0; index < 100; index += 1) {
    result = f.service.getExport(plan.id, { summary: true });
    if (result.status === 'finished') break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(result.status, 'finished');
  assert.deepEqual(sent, [id, id]);
  assert.equal(result.result.url, `https://open.spotify.com/playlist/${id}`);
  assert.equal(result.result.skipped, 1);
  assert.equal(result.result.rows[0].match.artist, 'Green Day');
  assert.equal(result.result.rows[2].status, 'not-found');
});

const hasPython = spawnSync(pythonExecutable(), ['--version'], { windowsHide: true }).status === 0;
test('SpotAPI adapter contracts, cookie parsing and pagination work without network access', { skip: !hasPython }, () => {
  const result = spawnSync(pythonExecutable(), ['-I', path.join(__dirname, 'spotify_bridge_test.py')], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
