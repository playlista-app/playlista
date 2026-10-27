const test = require('node:test');
const assert = require('node:assert/strict');
const { serializePlaylist, serializeTrack, parsePlaylistText } = require('../src/format');

const header = serializePlaylist({ name: 'Imported playlist', created: '2026-10-27T10:00:00.000Z', updated: '2026-10-27T10:00:00.000Z' });

test('quoted square brackets in imported titles and artist names remain literal text', () => {
  const tracks = [
    { artist: 'Green Day', title: 'Song [Live]' },
    { artist: 'Artist [Band]', title: 'Song' },
    { artist: 'Artist [Band]', title: 'Song [Remastered]', tags: ['hype', 'tag [brackets]'] },
    { title: 'Song [Explicit]' },
    { artist: 'Artist [Band]' },
    { artist: 'Artist', title: 'A "quoted" [title] > mix' },
    { artist: 'Artist', title: 'Only [an opening bracket' },
    { title: 'Only a closing bracket]' },
  ];
  const parsed = parsePlaylistText(header + tracks.map(serializeTrack).join('\n') + '\n');
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.playlist.songs.length, tracks.length);
  tracks.forEach((track, index) => {
    const actual = parsed.playlist.songs[index];
    assert.equal(actual.artist, track.artist || null);
    assert.equal(actual.title, track.title || null);
    assert.deepEqual(actual.tags, track.tags || []);
  });
});

test('labelled selectors ignore quoted brackets and still recognize a real trailing tag list', () => {
  const parsed = parsePlaylistText(header + 'artist: "Artist [Band]" > title: "Song [Live]" > [hype]\n');
  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.playlist.songs[0].artist, 'Artist [Band]');
  assert.equal(parsed.playlist.songs[0].title, 'Song [Live]');
  assert.deepEqual(parsed.playlist.songs[0].tags, ['hype']);
});

test('invalid unquoted or misplaced tag lists still produce validation errors', () => {
  for (const line of [
    'Artist > Song [Live]',
    'Artist [Band] > Song',
    'Artist > [tag] > Song',
    'Artist > Song > [tag] > [second]',
    'Artist > Song > [unfinished',
  ]) assert.ok(parsePlaylistText(header + line + '\n').issues.length > 0, line);
});
