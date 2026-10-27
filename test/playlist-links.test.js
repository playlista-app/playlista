const test = require('node:test');
const assert = require('node:assert/strict');
const { youtubePlaylistId, spotifyPlaylistId, resolveSpotifyPlaylistId } = require('../src/playlist-links');

const id = '0123456789abcdefghijkl';

test('YouTube accepts desktop, mobile, short, wrapped and scheme-less playlist links', () => {
  for (const link of [
    'https://music.youtube.com/playlist?list=PLexample&si=sharing',
    'https://www.youtube.com/watch?v=abcdefghijk&list=PLexample',
    'https://m.youtube.com/playlist?list=PLexample',
    'https://youtu.be/abcdefghijk?si=sharing&list=PLexample',
    'music.youtube.com/playlist?list=PLexample',
    'www.youtube.com/playlist?list=PLexample',
    '<https://music.youtube.com/playlist?list=PLexample>',
    'My playlist: https://youtu.be/abcdefghijk?si=sharing&amp;list=PLexample',
    'https://music.youtube.com/browse/VLPLexample',
    'PLexample', 'VLPLexample',
  ]) assert.equal(youtubePlaylistId(link), 'PLexample', link);
  assert.throws(() => youtubePlaylistId('https://youtu.be/abcdefghijk'), /video link alone/i);
  assert.throws(() => youtubePlaylistId('https://music.youtube.com.evil.example/playlist?list=PLexample'));
});

test('Spotify accepts direct shares, localized URLs, embed/legacy links and URIs', async () => {
  for (const link of [
    `https://open.spotify.com/playlist/${id}?si=sharing`,
    `https://open.spotify.com/intl-sv/playlist/${id}/`,
    `https://open.spotify.com/embed/playlist/${id}`,
    `https://open.spotify.com/user/somebody/playlist/${id}`,
    `open.spotify.com/playlist/${id}`,
    `Listen: https://open.spotify.com/playlist/${id}`,
    `spotify:playlist:${id}`, `spotify:user:somebody:playlist:${id}`, id,
  ]) {
    assert.equal(spotifyPlaylistId(link), id, link);
    assert.equal(await resolveSpotifyPlaylistId(link, () => { throw new Error('Direct links must not make a resolution request'); }), id);
  }
  assert.throws(() => spotifyPlaylistId(`https://open.spotify.com/album/${id}`), /Album, artist and track/);
});

test('Spotify short shares resolve through bounded Spotify-only redirects without credentials', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 302, headers: { location: calls.length === 1 ? '/second-hop' : `https://open.spotify.com/playlist/${id}?si=test` } });
  };
  assert.equal(await resolveSpotifyPlaylistId('https://spotify.link/example', request), id);
  assert.equal(calls.length, 2);
  for (const { options } of calls) {
    assert.equal(options.redirect, 'manual');
    assert.deepEqual(Object.keys(options.headers), ['user-agent']);
  }
  assert.equal(await resolveSpotifyPlaylistId('spotify.app.link/example', async () => new Response(null, { status: 302, headers: { location: `https://open.spotify.com/playlist/${id}` } })), id);
});

test('share resolution rejects unsafe redirects, loops, non-playlists and unavailable links', async () => {
  for (const target of ['http://127.0.0.1/private', 'https://evil.example/', 'https://open.spotify.com:8123/', 'file:///secret', `https://open.spotify.com/track/${id}`]) {
    let calls = 0;
    await assert.rejects(resolveSpotifyPlaylistId('https://spotify.link/example', async () => {
      calls += 1;
      return new Response(null, { status: 302, headers: { location: target } });
    }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(resolveSpotifyPlaylistId('https://spotify.link/example', async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { location: 'https://spotify.link/loop' } });
  }), /Could not expand/);
  assert.equal(calls, 5);
  await assert.rejects(resolveSpotifyPlaylistId('https://spotify.link/example', async () => { throw new Error('request diagnostics'); }), { statusCode: 502 });
});
