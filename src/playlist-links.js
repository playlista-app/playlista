const { StoreError } = require('./store');

function linkText(value) {
  const text = String(value || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
  // Browser/share sheets may wrap the URL or include a short caption.
  const url = text.match(/https?:\/\/[^\s<>"\x60]+/i)?.[0];
  return (url || text).replace(/&amp;/gi, '&').replace(/^[<"']+|[>"']+$/g, '').replace(/[)\],.]+$/, '');
}

function serviceUrl(value, hosts) {
  let text = linkText(value);
  if (hosts.some((host) => text.toLowerCase().startsWith(`${host}/`))) text = `https://${text}`;
  if (!/^https?:\/\//i.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { throw new StoreError('Enter a valid playlist link.'); }
  if (!hosts.includes(url.hostname) || url.username || url.password || url.port) throw new StoreError('Use a playlist link from the selected music service.');
  return url;
}

function youtubePlaylistId(value) {
  const text = linkText(value);
  const url = serviceUrl(text, ['music.youtube.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);
  let id = url ? url.searchParams.get('list') || /^\/browse\/VL([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1] || '' : text;
  if (id.startsWith('VL')) id = id.slice(2);
  if (!/^[A-Za-z0-9_-]{2,160}$/.test(id)) throw new StoreError('Enter a YouTube playlist link containing list=, or a playlist ID. A video link alone is not a playlist.');
  return id;
}

const SPOTIFY_HOSTS = ['open.spotify.com', 'spotify.link', 'spotify.app.link'];

function spotifyPlaylistId(value) {
  const text = linkText(value);
  const url = serviceUrl(text, SPOTIFY_HOSTS);
  let id;
  if (url) {
    if (url.hostname !== 'open.spotify.com') throw new StoreError('This Spotify share link needs resolving. Try importing the link again.');
    id = /\/(?:intl-[a-z-]+\/)?playlist\/([A-Za-z0-9]+)\/?$/.exec(url.pathname)?.[1] || '';
  } else id = /^(?:spotify:(?:user:[^:]+:)?playlist:)?([A-Za-z0-9]{22})$/.exec(text)?.[1] || '';
  if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new StoreError('Enter a Spotify playlist link or ID. Album, artist and track links cannot be imported as playlists.');
  return id;
}

async function resolveSpotifyPlaylistId(value, request = fetch) {
  let url = serviceUrl(value, SPOTIFY_HOSTS);
  if (!url || url.hostname === 'open.spotify.com') return spotifyPlaylistId(value);
  // Follow only Spotify-controlled hosts. No session cookies or tokens are sent
  // while expanding share links, and redirects cannot reach local/private URLs.
  for (let count = 0; count < 5; count += 1) {
    let response;
    try {
      response = await request(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Playlista' } });
    } catch { throw new StoreError('Could not open this Spotify share link. Open it in a browser and paste its full playlist URL.', 502); }
    const location = response.headers.get('location');
    const redirect = response.status >= 300 && response.status < 400;
    await response.body?.cancel().catch(() => {});
    if (!redirect || !location) break;
    let next;
    try { next = new URL(location, url); } catch { break; }
    if (!['https:', 'http:'].includes(next.protocol)) break;
    url = serviceUrl(next.toString(), SPOTIFY_HOSTS);
    if (url.hostname === 'open.spotify.com') return spotifyPlaylistId(url.toString());
  }
  throw new StoreError('Could not expand this Spotify share link. Open it in a browser and paste the full open.spotify.com playlist URL.');
}

module.exports = { youtubePlaylistId, spotifyPlaylistId, resolveSpotifyPlaylistId };
