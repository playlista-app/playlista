const { createMusicService, playlistId, exportSource, suggested } = require('./music-service');
const { runBridge } = require('./youtube-bridge');
function createYouTubeService(options = {}) { return createMusicService({ ...options, bridge: options.bridge || runBridge }); }
module.exports = { createYouTubeService, playlistId, exportSource, suggested };
