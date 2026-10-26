const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createGitHubService, countChanges } = require('../src/github');
const { serializePlaylist } = require('../src/format');

function playlist(name, tracks = ['Sum 41 > In Too Deep']) {
  return serializePlaylist({ name, created: '2026-10-26T10:00:00.000Z', updated: '2026-10-26T10:00:00.000Z' }) + tracks.join('\n') + '\n';
}

function setup({ localFiles = { 'punk.lista': playlist('Punk') }, remoteFiles = {}, initialized = false, branchFailure = 409 } = {}) {
  const local = new Map(Object.entries(localFiles));
  const remote = new Map(Object.entries(remoteFiles));
  const raw = { github: { owner: 'personal', repository: 'music', branch: 'main', login: 'personal', autoSync: false, folder: 'obsolete' }, syncState: {} };
  const writes = [];
  let time = '2026-10-26T11:00:00.000Z';
  let failPath = '';
  let invalid = false;
  let blobHook = null;
  const sha = (text) => createHash('sha256').update(text).digest('hex');
  const storage = {
    getPlaylistsDirectory: () => 'test-library',
    async readPlaylistFiles() { return [...local].map(([file, text]) => ({ file, text })); },
    async validateDirectory() { return { records: await this.readPlaylistFiles(), issues: invalid ? [{ message: 'invalid' }] : [] }; },
    async applyPlaylistFiles(files) {
      for (const file of files) {
        if (Object.hasOwn(file, 'expectedText') && local.get(file.path) !== file.expectedText) throw new Error('Newer local edits were kept');
      }
      for (const file of files) local.set(file.path, file.text);
      return files.map((file) => file.path);
    },
  };
  const settings = {
    getRawSettings: () => raw,
    async updateSyncState(key, state) { raw.syncState[key] = structuredClone(state); },
  };
  const request = async (url, options = {}, login) => {
    assert.equal(login, 'personal');
    const endpoint = new URL(url).pathname.replace('/repos/personal/music', '');
    const fail = (status, message) => { throw Object.assign(new Error(message), { githubStatus: status, githubMessage: message }); };
    if (endpoint === '') return { default_branch: 'main' };
    if (endpoint === '/branches/main') {
      if (!initialized) return fail(branchFailure, 'Git Repository is empty.');
      return { commit: { commit: { tree: { sha: 'tree-sha' } } } };
    }
    if (endpoint === '/branches') return initialized ? [{ name: 'main' }] : [];
    if (endpoint.startsWith('/branches/')) return fail(404, 'Branch not found');
    if (endpoint.startsWith('/git/trees/')) return { tree: [...remote].map(([path, text]) => ({ path, type: 'blob', sha: sha(text) })) };
    if (endpoint.startsWith('/git/blobs/')) {
      if (blobHook) await blobHook();
      const text = [...remote.values()].find((value) => sha(value) === endpoint.split('/').at(-1));
      assert.notEqual(text, undefined);
      return { content: Buffer.from(text).toString('base64') };
    }
    if (endpoint.startsWith('/contents/') && options.method === 'PUT') {
      const path = decodeURIComponent(endpoint.slice('/contents/'.length));
      const body = JSON.parse(options.body);
      if (path === failPath) return fail(409, 'Concurrent update');
      if (!initialized) assert.equal(body.branch, undefined, 'the Contents API must bootstrap the default branch');
      else assert.equal(body.branch, 'main');
      if (remote.has(path)) assert.equal(body.sha, sha(remote.get(path)));
      initialized = true;
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      remote.set(path, text);
      writes.push({ path, body });
      return { commit: { sha: 'new-commit' }, content: { sha: sha(text) } };
    }
    assert.fail(`Unexpected GitHub request: ${options.method || 'GET'} ${endpoint}`);
  };
  const service = createGitHubService({ storage, settings, request, now: () => time });
  return { service, local, remote, writes, raw, setTime: (value) => { time = value; }, failWritesTo: (value) => { failPath = value; }, makeInvalid: () => { invalid = true; }, onBlob: (hook) => { blobHook = hook; } };
}

test('first save initializes a 409 empty repository through Contents and mirrors relative paths at its root', async () => {
  const app = setup({ localFiles: { 'punk.lista': playlist('Punk'), 'nested/90s.lista': playlist('90s') } });
  assert.equal((await app.service.testConnection()).emptyRepository, true);
  const result = await app.service.sync('push');
  assert.equal(result.added, 2);
  assert.deepEqual([...app.remote.keys()].sort(), ['nested/90s.lista', 'punk.lista']);
  assert.equal((await app.service.getStatus()).pendingFiles, 0);
  assert.equal(app.writes[0].body.branch, undefined);
  assert.equal(app.writes[1].body.branch, 'main');
});

test('a 404 empty branch is also recognized and unrelated repository files are preserved', async () => {
  const empty = setup({ branchFailure: 404 });
  await empty.service.sync('push');
  assert.equal(empty.remote.size, 1);
  const existing = setup({ initialized: true, remoteFiles: { 'README.md': 'Personal music' } });
  await existing.service.sync('push');
  assert.equal(existing.remote.get('README.md'), 'Personal music');
  assert.equal(existing.writes.length, 1);
});

test('local edits become pending and sync timestamps change only when the file changes', async () => {
  const app = setup();
  await app.service.sync('push');
  const original = (await app.service.getStatus()).files[0].syncedAt;
  app.setTime('2026-10-26T12:00:00.000Z');
  await app.service.checkStatus();
  assert.equal((await app.service.getStatus()).files[0].syncedAt, original);
  app.local.set('punk.lista', playlist('Punk', ['Sum 41 > In Too Deep', 'Green Day > Basket Case']));
  assert.equal((await app.service.getStatus()).files[0].changes, 1);
  assert.equal((await app.service.getStatus()).pendingFiles, 1);
  await app.service.sync('auto');
  const synced = await app.service.getStatus();
  assert.equal(synced.pendingFiles, 0);
  assert.equal(synced.files[0].syncedAt, '2026-10-26T12:00:00.000Z');
});

test('automatic sync imports remote changes and new remote playlists', async () => {
  const app = setup();
  await app.service.sync('push');
  const changed = playlist('Punk', ['Green Day > Basket Case']);
  app.remote.set('punk.lista', changed);
  app.remote.set('metal.lista', playlist('Metal'));
  await app.service.checkStatus();
  assert.equal((await app.service.getStatus()).files.find((file) => file.file === 'punk.lista').status, 'remote-changed');
  await app.service.sync('auto');
  assert.equal(app.local.get('punk.lista'), changed);
  assert.equal(app.local.get('metal.lista'), app.remote.get('metal.lista'));
  assert.equal((await app.service.getStatus()).pendingFiles, 0);
});

test('conflicting edits are preserved until an explicit choice resolves them', async () => {
  const app = setup();
  await app.service.sync('push');
  app.local.set('punk.lista', playlist('Punk', ['Local > Song']));
  app.remote.set('punk.lista', playlist('Punk', ['Remote > Song']));
  const writesBefore = app.writes.length;
  const result = await app.service.sync('auto');
  assert.deepEqual(result.conflicts, ['punk.lista']);
  assert.equal(app.writes.length, writesBefore);
  assert.notEqual(app.local.get('punk.lista'), app.remote.get('punk.lista'));
  assert.equal((await app.service.getStatus()).files[0].status, 'conflict');
  await app.service.resolveConflicts('push', ['punk.lista']);
  assert.equal(app.remote.get('punk.lista'), app.local.get('punk.lista'));
  assert.equal((await app.service.getStatus()).pendingFiles, 0);
});

test('automatic sync restores missing copies without deleting the remaining backup', async () => {
  const app = setup();
  await app.service.sync('push');
  app.local.delete('punk.lista');
  await app.service.sync('auto');
  assert.equal(app.local.get('punk.lista'), app.remote.get('punk.lista'));
  app.remote.delete('punk.lista');
  await app.service.sync('auto');
  assert.equal(app.remote.get('punk.lista'), app.local.get('punk.lista'));
  assert.equal((await app.service.getStatus()).pendingFiles, 0);
});

test('failed uploads never advance the baseline for files that were not saved', async () => {
  const app = setup({ localFiles: { 'a.lista': playlist('A'), 'b.lista': playlist('B') } });
  app.failWritesTo('b.lista');
  await assert.rejects(app.service.sync('push'), /Concurrent update/);
  const status = await app.service.getStatus();
  assert.equal(status.files.find((file) => file.file === 'a.lista').status, 'synced');
  assert.equal(status.files.find((file) => file.file === 'b.lista').status, 'local-only');
  assert.equal(status.pendingFiles, 1);
});

test('invalid playlists and path casing conflicts are not uploaded', async () => {
  const invalid = setup();
  invalid.makeInvalid();
  await assert.rejects(invalid.service.sync('push'), /validation/);
  assert.equal(invalid.writes.length, 0);
  const casing = setup({ initialized: true, remoteFiles: { 'Punk.lista': playlist('Punk') } });
  const result = await casing.service.sync('auto');
  assert.deepEqual(result.conflicts.sort(), ['Punk.lista', 'punk.lista']);
  assert.equal(casing.writes.length, 0);
  assert.ok((await casing.service.getStatus()).files.every((file) => file.status === 'path-conflict'));
});

test('a file edited locally while GitHub is being read is not overwritten by an import', async () => {
  const app = setup();
  await app.service.sync('push');
  app.remote.set('punk.lista', playlist('Punk', ['Remote > Song']));
  app.onBlob(() => { app.local.set('punk.lista', playlist('Punk', ['Newer local > Song'])); });
  await assert.rejects(app.service.sync('pull'), /Newer local edits/);
  assert.match(app.local.get('punk.lista'), /Newer local/);
});

test('a missing configured branch in a populated repo is not treated as an empty repo', async () => {
  const app = setup({ initialized: true });
  app.raw.github.branch = 'missing';
  await assert.rejects(app.service.sync('push'), /Available branches: main/);
  assert.equal(app.writes.length, 0);
});

test('change counts include edits, removals and reordering while collapsing timestamps', () => {
  const before = playlist('Punk', ['One > Song', 'Two > Song']);
  assert.equal(countChanges(before, before), 0);
  assert.equal(countChanges(before, playlist('Punk', ['Two > Song', 'One > Song'])), 1);
  assert.equal(countChanges(before, playlist('Punk', ['One > Song'])), 1);
  assert.equal(countChanges(before, before.replace('updated: 2026-10-26T10:00', 'updated: 2026-10-26T11:00')), 1);
});
