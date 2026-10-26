const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { serializePlaylist } = require('../src/format');

test('local writes preserve edits made during sync and serialize concurrent song additions', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-sync-'));
  const originalMetadata = process.env.PLAYLISTA_TAG_METADATA_FILE;
  process.env.PLAYLISTA_TAG_METADATA_FILE = path.join(directory, 'tags.json');
  const storage = require('../src/store');
  const text = serializePlaylist({ name: 'Punk', created: '2026-10-26T10:00:00.000Z', updated: '2026-10-26T10:00:00.000Z' }) + 'Sum 41 > In Too Deep\n';
  const file = path.join(directory, 'punk.lista');
  try {
    await fs.writeFile(file, text);
    await storage.setPlaylistsDirectory(directory);
    await Promise.all([
      storage.addSong({ file: 'punk.lista', artist: 'Green Day', title: 'Basket Case' }),
      storage.addSong({ file: 'punk.lista', artist: 'blink-182', title: 'All The Small Things' }),
    ]);
    const edited = await fs.readFile(file, 'utf8');
    assert.match(edited, /Green Day > Basket Case/);
    assert.match(edited, /blink-182 > All The Small Things/);
    await assert.rejects(storage.applyPlaylistFiles([{ path: 'punk.lista', text, expectedText: text }], directory), /newer local edits were kept/);
    assert.equal(await fs.readFile(file, 'utf8'), edited);
    await assert.rejects(storage.applyPlaylistFiles([{ path: 'punk.lista', text, expectedText: undefined }], directory), /newer local edits were kept/);
    await fs.mkdir(path.join(directory, '.git'));
    await fs.writeFile(path.join(directory, '.git', 'internal.lista'), 'not a playlist');
    assert.equal((await storage.validateDirectory(directory)).issues.length, 0);
  } finally {
    if (originalMetadata === undefined) delete process.env.PLAYLISTA_TAG_METADATA_FILE;
    else process.env.PLAYLISTA_TAG_METADATA_FILE = originalMetadata;
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('playlista-sync-'));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
