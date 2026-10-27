const { createMusicService } = require('./music-service');
const { runBridge } = require('./spotify-bridge');
const { spotifyPlaylistId: playlistId, resolveSpotifyPlaylistId } = require('./playlist-links');

function createSpotifyService(options = {}) {
  return createMusicService({ ...options, bridge: options.bridge || runBridge, provider: 'spotify', label: 'Spotify', credentialField: 'cookies',
    validatePlaylistId: (value) => resolveSpotifyPlaylistId(value, options.resolveRequest), candidatePattern: /^[A-Za-z0-9]{22}$/,
    playlistUrl: (id) => `https://open.spotify.com/playlist/${encodeURIComponent(id)}`,
    validateConnection: (value) => Boolean(value?.auth?.cookies?.sp_dc && value.account?.id && value.account?.name),
  });
}
module.exports = { createSpotifyService, playlistId };
