const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { createYouTubeService, exportSource, playlistId, suggested } = require('../src/youtube');
const { runBridge, pythonExecutable } = require('../src/youtube-bridge');
const { spawnSync } = require('node:child_process');

const match = { id: 'abcdefghijk', artist: 'Sum 41', title: 'In Too Deep', album: 'All Killer No Filler', duration: '3:27' };
const makeLibrary = () => ({ valid: true, playlists: [
  { id: 'punk.lista', name: 'Punk', songs: [{ artist: 'Sum 41', title: 'In Too Deep' }] },
  { id: '90.lista', name: '90s Punk', parent: 'Punk', songs: [{ artist: 'Sum 41', title: 'In Too Deep' }] },
  { id: 'day.lista', name: 'Green Day', parent: '90s Punk', songs: [{ title: 'Unknown' }] },
] });

async function fixture(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-youtube-'));
  const credentialFile = path.join(directory, 'connection.json');
  const calls = [];
  const imports = [];
  let library = makeLibrary();
  let folder = 'library';
  const storage = {
    getLibrary: async () => library, getPlaylistsDirectory: () => folder,
    importSongs: async (input) => { imports.push(input); return { file: 'import.lista', imported: input.songs.length }; },
  };
  const bridge = async (input) => {
    calls.push(input);
    switch (input.action) {
      case 'probe': return { version: '1.12.3' };
      case 'connect': return { auth: { cookie: 'secret' }, account: { name: 'Personal', handle: '@personal' } };
      case 'seal': return 'encrypted-test-value';
      case 'unseal': return { auth: { cookie: 'secret' }, account: { name: 'Personal' } };
      case 'playlist': return { name: 'Remote', description: 'line one\nline two', songs: [match, match], skipped: 1 };
      case 'search': return input.query.includes('Unknown') ? [] : [match];
      case 'search_batch': return input.queries.map((query) => ({ query, matches: query.includes('Unknown') ? [] : [match] }));
      case 'create': return { id: 'PLcreated', complete: true, added: input.ids.length };
      default: throw new Error(`Unexpected ${input.action}`);
    }
  };
  const service = createYouTubeService({ bridge: overrides.bridge || bridge, storage, credentialFile, platform: 'win32', ...overrides });
  t.after(async () => {
    service.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('playlista-youtube-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const connect = async (remember = false) => {
    const preview = await service.previewConnection({ headers: 'test-headers' });
    await service.acceptConnection({ token: preview.token, remember });
  };
  const ready = async () => {
    const plan = await service.prepareExport({ file: 'punk.lista' });
    for (let index = 0; index < 100; index += 1) {
      const value = service.getExport(plan.id);
      if (value.status === 'ready') return value;
      await delay(2);
    }
    throw new Error('Matching did not finish.');
  };
  return { service, calls, imports, connect, ready, credentialFile,
    setLibrary: (value) => { library = value; }, setFolder: (value) => { folder = value; } };
}

test('YouTube account must be previewed and accepted; only encrypted credentials persist', async (t) => {
  const f = await fixture(t);
  const preview = await f.service.previewConnection({ headers: 'test-headers' });
  assert.equal((await f.service.status()).connected, false);
  assert.equal(preview.account.handle, '@personal');
  assert.equal(JSON.stringify(preview).includes('secret'), false);
  await assert.rejects(f.service.acceptConnection({ token: 'wrong' }), /expired/);
  await f.service.acceptConnection({ token: preview.token, remember: true });
  const saved = await fs.readFile(f.credentialFile, 'utf8');
  assert.doesNotMatch(saved, /secret|cookie|Personal/);
  assert.equal(JSON.parse(saved).ciphertext, 'encrypted-test-value');
  const restored = createYouTubeService({ bridge: async ({ action }) => action === 'unseal'
    ? { auth: { cookie: 'secret' }, account: { name: 'Personal' } } : {}, credentialFile: f.credentialFile, platform: 'win32' });
  t.after(() => restored.close());
  assert.equal((await restored.status()).account.name, 'Personal');
  await f.service.disconnect();
  assert.equal((await f.service.status()).connected, false);
  await assert.rejects(fs.readFile(f.credentialFile), { code: 'ENOENT' });
  await assert.rejects(f.service.importPlaylist({ id: 'PLtest' }), /Connect YouTube/);
});

test('YouTube import preserves duplicate songs and order in new or existing playlists', async (t) => {
  const f = await fixture(t);
  await f.connect();
  const result = await f.service.importPlaylist({ id: 'https://music.youtube.com/playlist?list=PLtest' });
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 1);
  assert.deepEqual(f.imports[0], { file: undefined, name: 'Remote', description: 'line one line two',
    songs: [{ artist: 'Sum 41', title: 'In Too Deep' }, { artist: 'Sum 41', title: 'In Too Deep' }] });
  await f.service.importPlaylist({ id: 'PLtest', file: 'punk.lista', name: 'Custom' });
  assert.equal(f.imports[1].file, 'punk.lista');
  assert.equal(f.imports[1].name, 'Custom');
  assert.equal(playlistId('https://www.youtube.com/playlist?list=PLtest'), 'PLtest');
  assert.throws(() => playlistId('https://example.com/?list=PLtest'));
});

test('YouTube export includes descendants, selects first results and preserves duplicates', async (t) => {
  const f = await fixture(t);
  await f.connect();
  const plan = await f.ready();
  assert.equal(plan.total, 3);
  assert.deepEqual(plan.rows.map((r) => r.origin), ['Punk', '90s Punk', 'Green Day']);
  assert.deepEqual(plan.rows.map((r) => r.selected), [match.id, match.id, '']);
  assert.deepEqual(f.calls.find((c) => c.action === 'search_batch').queries, ['Sum 41 In Too Deep', 'Unknown'], 'duplicate queries share one lookup');
  await assert.rejects(f.service.exportPlaylist({ id: plan.id, selections: [match.id, 'invalid', ''] }), /preview results/);
  const result = await f.service.exportPlaylist({ id: plan.id, selections: [match.id, match.id, ''] });
  assert.equal(result.added, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.url, 'https://music.youtube.com/playlist?list=PLcreated');
  assert.deepEqual(f.calls.find((c) => c.action === 'create').ids, [match.id, match.id]);
  await assert.rejects(f.service.exportPlaylist({ id: plan.id, selections: [match.id, match.id, ''] }), /already/);
  assert.equal(exportSource(makeLibrary(), 'day.lista').tracks.length, 1);
  assert.equal(suggested({ title: match.title }, [match]), match.id);
  assert.equal(suggested({ artist: match.artist, title: match.title }, [match, { ...match, id: 'mnopqrstuvw' }]), match.id);
  assert.equal(suggested({ artist: 'Sum*', title: match.title }, [match]), match.id);
  assert.equal(suggested({ title: 'Nothing' }, []), '');
  assert.deepEqual(result.rows.map((row) => row.status), ['exported', 'exported', 'not-found']);
  assert.equal(result.rows[0].match.title, 'In Too Deep');
});

test('export rejects stale playlists, folder changes and account changes without remote writes', async (t) => {
  const f = await fixture(t);
  await f.connect();
  let plan = await f.ready();
  const changed = makeLibrary();
  changed.playlists[1].songs.push({ title: 'Another song' });
  f.setLibrary(changed);
  await assert.rejects(f.service.exportPlaylist({ id: plan.id, selections: [match.id, match.id, ''] }), /changed after/);
  f.setLibrary(makeLibrary());
  plan = await f.ready();
  f.setFolder('another folder');
  await assert.rejects(f.service.exportPlaylist({ id: plan.id, selections: [match.id, match.id, ''] }), /changed after/);
  await f.service.disconnect();
  await f.connect();
  assert.throws(() => f.service.getExport(plan.id), /expired/);
  assert.equal(f.calls.some((c) => c.action === 'create'), false);
});

test('export supports manual song searches and cancellation', async (t) => {
  const f = await fixture(t);
  await f.connect();
  const plan = await f.ready();
  const result = await f.service.searchRow({ id: plan.id, index: 2, query: 'Sum 41 In Too Deep' });
  assert.equal(result.row.candidates[0].id, match.id);
  assert.equal(result.row.selected, match.id);
  await assert.rejects(f.service.searchRow({ id: plan.id, index: -1, query: 'test' }), /valid song/);
  f.service.cancelExport(plan.id);
  assert.throws(() => f.service.getExport(plan.id), /expired/);
});

test('automatic export takes the first match for title-only Basket Case and reports missing songs', async (t) => {
  const greenDay = { id: 'mnopqrstuvw', title: 'Basket Case', artist: 'Green Day' };
  const f = await fixture(t, { bridge: async (input) => {
    if (input.action === 'connect') return { auth: {}, account: { name: 'Personal' } };
    if (input.action === 'search_batch') return input.queries.map((query) => ({ query,
      matches: query === 'Basket Case' ? [greenDay, match] : [],
      ...(query === 'Error' ? { error: 'Search is unavailable' } : {}) }));
    if (input.action === 'create') { assert.deepEqual(input.ids, [greenDay.id]); return { id: 'PLcreated', complete: true, added: 1 }; }
    throw new Error(`Unexpected ${input.action}`);
  } });
  f.setLibrary({ valid: true, playlists: [{ id: 'punk.lista', name: 'Punk', songs: [{ title: 'Basket Case' }, { title: 'Unknown' }, { title: 'Error' }] }] });
  await f.connect();
  const plan = await f.service.prepareExport({ file: 'punk.lista', automatic: true });
  let result;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    result = f.service.getExport(plan.id, { summary: true });
    if (result.status === 'finished') break;
    await delay(2);
  }
  assert.equal(result.status, 'finished');
  assert.equal(Object.hasOwn(result, 'rows'), false, 'polling omits candidate lists');
  assert.equal(result.result.added, 1);
  assert.equal(result.result.skipped, 2);
  assert.equal(result.result.rows[0].match.artist, 'Green Day');
  assert.deepEqual(result.result.rows.map((row) => row.status), ['exported', 'not-found', 'search-failed']);
});

test('a thousand-song export batches lookups with bounded concurrency and progressive counts', async (t) => {
  let concurrent = 0;
  let peak = 0;
  let lookups = 0;
  let created;
  const f = await fixture(t, { bridge: async (input, options) => {
    if (input.action === 'connect') return { auth: {}, account: { name: 'Test' } };
    if (input.action === 'search_batch') {
      assert.ok(input.queries.length <= 25);
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      lookups += input.queries.length;
      await delay(1);
      const result = input.queries.map((query) => ({ query, matches: [match] }));
      for (const item of result) options.onProgress(item);
      concurrent -= 1;
      return result;
    }
    if (input.action === 'create') { created = input.ids; return { id: 'PLlarge', complete: true, added: input.ids.length }; }
    throw new Error(`Unexpected ${input.action}`);
  } });
  f.setLibrary({ valid: true, playlists: [{ id: 'punk.lista', name: 'Large', songs: Array.from({ length: 1000 }, (_, index) => ({ title: `Song ${index % 500}` })) }] });
  await f.connect();
  const plan = await f.service.prepareExport({ file: 'punk.lista', automatic: true });
  let result;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    result = f.service.getExport(plan.id, { summary: true });
    if (result.status === 'finished') break;
    await delay(2);
  }
  assert.equal(result.status, 'finished');
  assert.equal(result.completed, 1000);
  assert.equal(lookups, 500);
  assert.equal(peak, 2);
  assert.equal(created.length, 1000);
  assert.equal(result.result.rows.length, 1000);
});

test('all-missing automatic exports report skips without creating an empty remote playlist', async (t) => {
  const f = await fixture(t);
  f.setLibrary({ valid: true, playlists: [{ id: 'punk.lista', name: 'Missing', songs: [{ title: 'Unknown' }] }] });
  await f.connect();
  const plan = await f.service.prepareExport({ file: 'punk.lista', automatic: true });
  let value;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    value = f.service.getExport(plan.id);
    if (value.status === 'finished') break;
    await delay(2);
  }
  assert.equal(value.result.skipped, 1);
  assert.equal(value.result.url, '');
  assert.equal(f.calls.some((call) => call.action === 'create'), false);
});

test('cancelling automatic matching aborts its helpers and prevents a remote write', async (t) => {
  let started;
  const matching = new Promise((resolve) => { started = resolve; });
  let aborted = false;
  let wrote = false;
  const f = await fixture(t, { bridge: async (input, options) => {
    if (input.action === 'connect') return { auth: {}, account: { name: 'Test' } };
    if (input.action === 'search_batch') return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('Cancelled')); }, { once: true });
      started();
    });
    if (input.action === 'create') { wrote = true; throw new Error('Unexpected write'); }
    throw new Error(`Unexpected ${input.action}`);
  } });
  await f.connect();
  const plan = await f.service.prepareExport({ file: 'punk.lista', automatic: true });
  await matching;
  f.service.cancelExport(plan.id);
  await delay(2);
  assert.equal(aborted, true);
  assert.equal(wrote, false);
});

test('partial exports retain chosen matches and mark them unverified in results', async (t) => {
  const f = await fixture(t, { bridge: async (input) => {
    if (input.action === 'connect') return { auth: {}, account: { name: 'Test' } };
    if (input.action === 'search_batch') return input.queries.map((query) => ({ query, matches: [match] }));
    if (input.action === 'create') return { id: 'PLpartial', complete: false, added: 1, warning: 'Inspect this partial playlist.' };
    throw new Error(`Unexpected ${input.action}`);
  } });
  await f.connect();
  const plan = await f.service.prepareExport({ file: 'punk.lista', automatic: true });
  let value;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    value = f.service.getExport(plan.id, { summary: true });
    if (value.status === 'finished') break;
    await delay(2);
  }
  assert.equal(value.result.complete, false);
  assert.equal(value.result.added, 1);
  assert.match(value.result.url, /PLpartial/);
  assert.equal(value.result.rows.every((row) => row.status === 'unverified'), true);
});

const hasPython = spawnSync(pythonExecutable(), ['--version'], { windowsHide: true }).status === 0;
test('Python bridge parses browser formats and verifies remote writes without network access', { skip: !hasPython }, () => {
  const result = spawnSync(pythonExecutable(), ['-I', path.join(__dirname, 'youtube_bridge_test.py')], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('Windows credentials use a real DPAPI round trip through the Node bridge', { skip: !hasPython || process.platform !== 'win32' }, async () => {
  const secret = { auth: { cookie: 'synthetic test credential only' }, account: { name: 'Test' } };
  const sealed = await runBridge({ action: 'seal', value: secret });
  assert.equal(typeof sealed, 'string');
  assert.equal(sealed.includes('synthetic'), false);
  assert.deepEqual(await runBridge({ action: 'unseal', value: sealed }), secret);
});
