const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
  getLibrary,
  createPlaylist,
  setPlaylistParent,
  updatePlaylist,
  addSong,
  setSongTags,
  removeSong,
  moveSong,
  getTagMetadata,
  registerTagNames,
  updateTagMetadata,
  getPlaylistsDirectory,
  setPlaylistsDirectory,
  StoreError,
} = require('./store');
const appSettings = require('./app-settings');
const github = require('./github');
const { createSyncManager } = require('./sync-manager');
const spotify = require('./spotify');
const { createYouTubeService } = require('./youtube');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_PORT = 43817;

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/playlist-ui.js', ['playlist-ui.js', 'text/javascript; charset=utf-8']],
  ['/youtube-ui.js', ['youtube-ui.js', 'text/javascript; charset=utf-8']],
  ['/youtube-export-ui.js', ['youtube-export-ui.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);

function isLocalHost(hostHeader = '') {
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function sendSpotifyCallback(response, success, message) {
  const content = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotify · Playlista</title><body style="font:16px system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:24px;color:#202820"><h1>${success ? 'Spotify connected' : 'Spotify could not connect'}</h1><p>${escapeHtml(message)}</p><p>You can close this window and return to Playlista.</p><script>history.replaceState({},'',location.pathname);if(window.opener)window.opener.postMessage({type:'playlista-spotify-auth',success:${Boolean(success)}},'*');if(${Boolean(success)})setTimeout(()=>window.close(),500)</script></body></html>`;
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  response.end(content);
}

async function readJson(request, maximum = MAX_BODY_BYTES) {
  const contentType = request.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new StoreError('Send JSON data.', 415);
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) throw new StoreError('Request is too large.', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object.');
    return value;
  } catch (error) {
    throw new StoreError(`Invalid JSON: ${error.message}`, 400);
  }
}

async function serveStatic(requestPath, response) {
  const file = STATIC_FILES.get(requestPath);
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }
  const content = await fs.readFile(path.join(PUBLIC_DIR, file[0]));
  response.writeHead(200, {
    'content-type': file[1],
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  response.end(content);
}

function createServer(syncManager, youtube) {
  const server = http.createServer(async (request, response) => {
  if (!isLocalHost(request.headers.host)) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Local requests only');
    return;
  }

  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'POST' && request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) {
    sendJson(response, 403, { error: 'Local app requests only.' });
    return;
  }
  response.once('finish', () => {
    if (request.method !== 'POST' || response.statusCode >= 400) return;
    if (url.pathname === '/api/settings' || url.pathname === '/api/github/account') syncManager.reconfigure();
    else if (/^\/api\/(songs|playlists)(\/|$)/.test(url.pathname)
      || url.pathname === '/api/tags/update' || url.pathname === '/api/spotify/import'
      || url.pathname === '/api/youtube/import') syncManager.notifyLocalChange();
  });
  try {
    if (request.method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, { online: true, sync: await syncManager.getStatus() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/library') {
      sendJson(response, 200, { ...await getLibrary(), sync: await syncManager.getStatus() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/tags') {
      sendJson(response, 200, { tags: await getTagMetadata() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/settings') {
      const settings = appSettings.publicSettings({ getPlaylistsDirectory });
      settings.spotify.redirectUri = `http://127.0.0.1:${request.socket.localPort}/spotify/callback`;
      sendJson(response, 200, settings);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/status') {
      sendJson(response, 200, spotify.getStatus());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/youtube/status') {
      sendJson(response, 200, await youtube.status());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/youtube/playlists') {
      sendJson(response, 200, { playlists: await youtube.playlists() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/youtube/export') {
      sendJson(response, 200, youtube.getExport(url.searchParams.get('id'), { summary: url.searchParams.get('summary') === 'true' }));
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/youtube/')) {
      const input = await readJson(request, url.pathname === '/api/youtube/export' ? 256 * 1024 : MAX_BODY_BYTES);
      const actions = {
        '/api/youtube/connect': () => youtube.previewConnection(input),
        '/api/youtube/accept': () => youtube.acceptConnection(input),
        '/api/youtube/disconnect': () => youtube.disconnect(),
        '/api/youtube/export/prepare': () => youtube.prepareExport(input),
        '/api/youtube/export/search': () => youtube.searchRow(input),
        '/api/youtube/export/cancel': () => youtube.cancelExport(input.id),
        '/api/youtube/export': () => youtube.exportPlaylist(input),
        '/api/youtube/import': async () => ({ ...await youtube.importPlaylist(input), library: await getLibrary(), tags: await getTagMetadata() }),
      };
      const action = actions[url.pathname];
      if (!action) throw new StoreError('Unknown YouTube Music operation.', 404);
      sendJson(response, url.pathname === '/api/youtube/import' ? 201 : 200, await action());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/spotify/connect') {
      const input = await readJson(request);
      sendJson(response, 200, spotify.beginAuthorization(input.clientId, request.socket.localPort));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/spotify/disconnect') {
      sendJson(response, 200, spotify.disconnect());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/spotify/playlists') {
      sendJson(response, 200, { playlists: await spotify.getPlaylists() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/spotify/import') {
      const input = await readJson(request);
      const imported = await spotify.importPlaylist(input);
      const result = await getLibrary();
      sendJson(response, 201, { ...imported, library: result, tags: await getTagMetadata() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/settings') {
      const input = await readJson(request);
      const settings = await appSettings.saveSettings(input, { getPlaylistsDirectory, setPlaylistsDirectory });
      settings.spotify.redirectUri = `http://127.0.0.1:${request.socket.localPort}/spotify/callback`;
      sendJson(response, 200, { settings, library: await getLibrary() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/github/test') {
      sendJson(response, 200, { ...await syncManager.testConnection(), sync: await syncManager.getStatus() });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/github/status') {
      sendJson(response, 200, await syncManager.getStatus());
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/github/accounts') {
      sendJson(response, 200, await github.listAccounts());
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/github/account') {
      const input = await readJson(request);
      sendJson(response, 200, await github.selectAccount(input.login));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/github/sync') {
      const input = await readJson(request);
      const result = await syncManager.sync(input.direction, input.file);
      sendJson(response, 200, { ...result, library: await getLibrary(), tags: await getTagMetadata(), sync: await syncManager.getStatus() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/github/resolve') {
      const input = await readJson(request);
      const result = await syncManager.resolveConflicts(input.direction, input.paths);
      sendJson(response, 200, { ...result, library: await getLibrary(), tags: await getTagMetadata(), sync: await syncManager.getStatus() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/playlists') {
      const input = await readJson(request);
      const created = await createPlaylist(input);
      sendJson(response, 201, { ...created, library: await getLibrary(), tags: await getTagMetadata() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/playlists/parent') {
      const input = await readJson(request);
      const changed = await setPlaylistParent(input);
      sendJson(response, 200, { ...changed, library: await getLibrary() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/playlists/update') {
      const input = await readJson(request);
      const changed = await updatePlaylist(input);
      sendJson(response, 200, { ...changed, library: await getLibrary(), tags: await getTagMetadata() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/songs') {
      const input = await readJson(request);
      const added = await addSong(input);
      sendJson(response, 201, { ...added, library: await getLibrary(), tags: await getTagMetadata() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/songs/tags') {
      const input = await readJson(request);
      const changed = await setSongTags(input);
      sendJson(response, 200, { ...changed, library: await getLibrary(), tags: await getTagMetadata() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/songs/remove') {
      const input = await readJson(request);
      const removed = await removeSong(input);
      sendJson(response, 200, { ...removed, library: await getLibrary() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/songs/move') {
      const input = await readJson(request);
      const moved = await moveSong(input);
      sendJson(response, 200, { ...moved, library: await getLibrary() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/tags/register') {
      const input = await readJson(request);
      sendJson(response, 200, { tags: await registerTagNames(input.tags || []) });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/tags/update') {
      const input = await readJson(request);
      const tags = await updateTagMetadata(input);
      sendJson(response, 200, { tags, library: await getLibrary() });
      return;
    }
    if (request.method === 'GET') {
      if (url.pathname === '/spotify/callback') {
        try {
          await spotify.completeAuthorization(url);
          sendSpotifyCallback(response, true, 'Your Spotify playlists are ready to import.');
        } catch (error) {
          sendSpotifyCallback(response, false, error.message || 'Return to Playlista and try again.');
        }
        return;
      }
      await serveStatic(url.pathname, response);
      return;
    }
    sendJson(response, 405, { error: 'Method not allowed.' });
  } catch (error) {
    if (error.name === 'AbortError' || response.destroyed) return;
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    sendJson(response, status, { error: status === 500 ? 'The local app could not complete that request.' : error.message });
    if (status === 500) console.error(error);
  }
  });
  return server;
}

async function startServer({ port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10), host = '127.0.0.1', youtube: suppliedYouTube } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be a number between 1 and 65535.');
  }
  await appSettings.initialize({ setPlaylistsDirectory, getPlaylistsDirectory });
  await getLibrary();
  const syncManager = createSyncManager();
  const youtube = suppliedYouTube || createYouTubeService();
  const server = createServer(syncManager, youtube);
  server.once('close', () => { syncManager.stop(); youtube.close(); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  syncManager.start();
  return { server, address: server.address() };
}

if (require.main === module) {
  const port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10);
  startServer({ port })
    .then(({ address, server }) => {
      const shutdown = () => {
        server.closeAllConnections?.();
        server.close();
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      const actualPort = typeof address === 'object' ? address.port : port;
      console.log(`Playlista is running at http://127.0.0.1:${actualPort}`);
      console.log(`Playlist files are stored in ${getPlaylistsDirectory()}`);
    })
    .catch((error) => {
      console.error(`Playlista could not start: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = { startServer };
