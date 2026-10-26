const crypto = require('node:crypto');
const { StoreError, importSpotifySongs } = require('./store');

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';
const SPOTIFY_API_URL = 'https://api.spotify.com/v1';
const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-read-private'];

let pendingAuthorization = null;
let session = null;
let refreshInFlight = null;

function makeError(message, statusCode = 400) {
  return new StoreError(message, statusCode);
}

function redirectUri(port) {
  return `http://127.0.0.1:${port}/spotify/callback`;
}

function beginAuthorization(clientId, port) {
  if (!clientId || !/^[A-Za-z0-9]{20,128}$/.test(clientId)) {
    throw makeError('Enter a valid Spotify Client ID in Settings first.');
  }
  const verifier = crypto.randomBytes(48).toString('base64url');
  const state = crypto.randomBytes(24).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const callback = redirectUri(port);
  pendingAuthorization = { clientId, verifier, state, callback };
  const authorize = new URL(SPOTIFY_AUTHORIZE_URL);
  authorize.search = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: callback,
    scope: SCOPES.join(' '),
    state,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  return { authorizationUrl: authorize.toString(), redirectUri: callback };
}

async function completeAuthorization(url) {
  const state = url.searchParams.get('state');
  const pending = pendingAuthorization;
  pendingAuthorization = null;
  if (!pending || !state || state !== pending.state) throw makeError('Spotify sign-in expired or could not be verified.', 400);
  const oauthError = url.searchParams.get('error');
  if (oauthError) throw makeError(oauthError === 'access_denied' ? 'Spotify access was not approved.' : 'Spotify could not complete sign-in.');
  const code = url.searchParams.get('code');
  if (!code) throw makeError('Spotify did not return an authorization code.');

  const response = await fetch(SPOTIFY_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: pending.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.callback,
      code_verifier: pending.verifier,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) {
    throw makeError(result.error_description || 'Spotify could not exchange the sign-in code. Check the Client ID and redirect URI.', response.status === 401 ? 401 : 400);
  }
  session = {
    clientId: pending.clientId,
    accessToken: result.access_token,
    refreshToken: result.refresh_token || '',
    expiresAt: Date.now() + (Number(result.expires_in) || 3600) * 1000,
  };
  refreshInFlight = null;
}

function getStatus() {
  return { connected: Boolean(session?.accessToken) };
}

function disconnect() {
  session = null;
  pendingAuthorization = null;
  refreshInFlight = null;
  return getStatus();
}

async function refreshAccessToken() {
  if (!session?.refreshToken) throw makeError('Reconnect Spotify to continue importing.', 401);
  if (refreshInFlight) return refreshInFlight;
  const current = session;
  refreshInFlight = (async () => {
    const response = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: current.clientId,
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.access_token) {
      session = null;
      throw makeError('Spotify sign-in expired. Connect Spotify again.', 401);
    }
    if (session === current) {
      session = {
        ...current,
        accessToken: result.access_token,
        refreshToken: result.refresh_token || current.refreshToken,
        expiresAt: Date.now() + (Number(result.expires_in) || 3600) * 1000,
      };
    }
    return session.accessToken;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function accessToken(forceRefresh = false) {
  if (!session?.accessToken) throw makeError('Connect Spotify in Settings first.', 401);
  if (forceRefresh || session.expiresAt < Date.now() + 60_000) return refreshAccessToken();
  return session.accessToken;
}

async function spotifyGet(endpoint, retry = true) {
  const token = await accessToken();
  const response = await fetch(`${SPOTIFY_API_URL}${endpoint}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (response.status === 401 && retry && session?.refreshToken) {
    await accessToken(true);
    return spotifyGet(endpoint, false);
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      session = null;
      throw makeError('Spotify sign-in expired. Connect Spotify again.', 401);
    }
    if (response.status === 403) {
      throw makeError('Spotify does not allow reading this playlist. Its items may be available only to the owner or collaborators.', 403);
    }
    if (response.status === 429) throw makeError('Spotify is temporarily limiting requests. Wait a moment and try again.', 429);
    const detail = result.error?.message || result.error_description;
    throw makeError(detail ? `Spotify request failed: ${detail}` : `Spotify request failed (${response.status}).`, response.status >= 500 ? 502 : response.status);
  }
  return result;
}

async function getPlaylists() {
  const user = await spotifyGet('/me');
  const playlists = [];
  let offset = 0;
  while (true) {
    const page = await spotifyGet(`/me/playlists?limit=50&offset=${offset}`);
    const rows = Array.isArray(page.items) ? page.items : [];
    playlists.push(...rows.map((playlist) => ({
      id: playlist.id,
      name: playlist.name || 'Untitled Spotify playlist',
      description: playlist.description || '',
      total: playlist.items?.total ?? playlist.tracks?.total ?? 0,
      collaborative: Boolean(playlist.collaborative),
      importable: playlist.owner?.id === user.id || Boolean(playlist.collaborative),
      url: playlist.external_urls?.spotify || '',
    })));
    if (!page.next || rows.length === 0) break;
    offset += rows.length;
  }
  return playlists;
}

async function importPlaylist(playlist) {
  const id = String(playlist?.id || '').trim();
  if (!/^[A-Za-z0-9]+$/.test(id)) throw makeError('Choose a valid Spotify playlist.');
  const songs = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const page = await spotifyGet(`/playlists/${encodeURIComponent(id)}/items?limit=50&offset=${offset}`);
    const rows = Array.isArray(page.items) ? page.items : [];
    total = Number.isFinite(page.total) ? page.total : offset + rows.length;
    for (const row of rows) {
      const item = row?.item || row?.track || null;
      if (!item || item.type === 'episode' || item.show || item.type === 'audiobook') continue;
      const title = typeof item.name === 'string' ? item.name.replace(/[\r\n]+/g, ' ').trim() : '';
      const artists = Array.isArray(item.artists)
        ? item.artists.map((artist) => typeof artist?.name === 'string' ? artist.name.replace(/[\r\n]+/g, ' ').trim() : '').filter(Boolean)
        : [];
      const artist = artists.join(', ');
      if (title || artist) songs.push({ artist, title });
    }
    if (rows.length === 0 || offset + rows.length >= total) break;
    offset += rows.length;
    if (songs.length > 10000) throw makeError('A single import is limited to 10,000 songs.', 413);
  }
  if (songs.length === 0) throw makeError('This Spotify playlist has no importable songs.');
  const result = await importSpotifySongs({
    file: playlist.file,
    name: String(playlist.name || '').replace(/[\r\n]+/g, ' ').trim(),
    description: String(playlist.description || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 1000),
    songs,
  });
  return { ...result, skipped: Math.max(0, total - songs.length) };
}

module.exports = { beginAuthorization, completeAuthorization, getStatus, disconnect, getPlaylists, importPlaylist };
