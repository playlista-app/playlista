const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const store = require('./store');
const { runBridge } = require('./youtube-bridge');

const clean = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
const fail = (message, status = 400) => new store.StoreError(message, status);

function playlistId(value) {
  let id = clean(value);
  if (/^https?:/.test(id)) {
    let url;
    try { url = new URL(id); } catch { throw fail('Enter a YouTube Music playlist URL or ID.'); }
    if (!['music.youtube.com', 'www.youtube.com', 'youtube.com'].includes(url.hostname)) throw fail('Enter a YouTube Music playlist URL.');
    id = url.searchParams.get('list') || '';
  }
  if (!/^[A-Za-z0-9_-]{2,160}$/.test(id)) throw fail('Enter a YouTube Music playlist URL or ID.');
  return id;
}

function exportSource(library, file) {
  if (!library.valid) throw fail('Fix playlist validation errors before exporting.');
  const selected = library.playlists.find((p) => p.id === file);
  if (!selected) throw fail('Playlist was not found.', 404);
  const key = (name) => name?.toLocaleLowerCase('en-US');
  const visited = new Set();
  const tracks = [];
  function collect(playlist) {
    if (visited.has(playlist.id)) throw fail('A playlist parent cycle prevents export.');
    visited.add(playlist.id);
    tracks.push(...playlist.songs.map((song) => ({ artist: song.artist || '', title: song.title || '', origin: playlist.name })));
    const children = library.playlists.filter((p) => key(p.parent) === key(playlist.name));
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) collect(child);
  }
  collect(selected);
  if (!tracks.length) throw fail('This playlist has no songs to export.');
  if (tracks.length > 10000) throw fail('A single export is limited to 10,000 songs.');
  const source = { name: selected.name, description: selected.description || '', tracks };
  return { ...source, fingerprint: createHash('sha256').update(JSON.stringify(source)).digest('hex') };
}

function candidates(items) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!/^[A-Za-z0-9_-]{11}$/.test(item.id) || !clean(item.title) || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, 8).map((item) => ({ id: item.id, title: clean(item.title), artist: clean(item.artist), album: clean(item.album), duration: clean(item.duration) }));
}

function suggested(song, matches) {
  return matches[0]?.id || '';
}

function createYouTubeService({ bridge: requestBridge = runBridge, storage = store, credentialFile, platform = process.platform, now = Date.now } = {}) {
  const shutdown = new AbortController();
  const bridge = (input, options) => requestBridge(input, { ...options, signal: options?.signal || shutdown.signal });
  const secretsFile = credentialFile || process.env.PLAYLISTA_YOUTUBE_CREDENTIALS_FILE || path.join(
    path.dirname(process.env.PLAYLISTA_SETTINGS_FILE || path.join(__dirname, '..', 'data/app-settings.json')), 'youtube-connection.json');
  let session = null;
  let pending = null;
  let plan = null;
  let generation = 0;
  let restored = null;
  let busy = false;
  let restoreError = '';

  async function restore() {
    if (!restored) restored = (async () => {
      try {
        const saved = JSON.parse(await fs.readFile(secretsFile, 'utf8'));
        if (saved.version !== 1 || platform !== 'win32' || typeof saved.ciphertext !== 'string') throw new Error();
        const value = await bridge({ action: 'unseal', value: saved.ciphertext });
        if (!value?.auth || !value?.account?.name) throw new Error();
        session = { ...value, remembered: true };
      } catch (error) {
        if (error.code !== 'ENOENT') restoreError = 'Saved connection could not be unlocked. Reconnect YouTube Music.';
      }
    })();
    await restored;
  }

  async function status() {
    await restore();
    let runtime;
    try { runtime = { available: true, ...await bridge({ action: 'probe' }) }; }
    catch (error) { runtime = { available: false, error: error.message }; }
    return { connected: Boolean(session), account: session?.account || null, remembered: Boolean(session?.remembered),
      canRemember: platform === 'win32', runtime, error: restoreError };
  }

  async function connection() {
    await restore();
    if (!session) throw fail('Connect YouTube Music in Settings first.', 401);
    return session;
  }

  function ensureIdle() {
    if (busy) throw fail('Wait for the current YouTube Music operation to finish.', 409);
  }

  async function previewConnection(input) {
    await restore();
    ensureIdle();
    const headers = String(input.headers || '').trim();
    if (!headers || Buffer.byteLength(headers) > 60000) throw fail('Paste your YouTube Music request headers (up to 60 KB).');
    busy = true;
    try {
      const result = await bridge({ action: 'connect', headers });
      const token = randomUUID();
      pending = { ...result, token, expires: now() + 5 * 60_000 };
      return { token, account: result.account, canRemember: platform === 'win32' };
    } finally { busy = false; }
  }

  async function acceptConnection(input) {
    await restore();
    ensureIdle();
    const value = pending;
    if (!value || input.token !== value.token || value.expires < now()) throw fail('Account preview expired. Check your connection again.', 409);
    busy = true;
    try {
      const remembered = input.remember === true;
      if (remembered) {
        if (platform !== 'win32') throw fail('Use a session-only connection on this operating system.');
        const ciphertext = await bridge({ action: 'seal', value: { auth: value.auth, account: value.account } });
        await fs.mkdir(path.dirname(secretsFile), { recursive: true });
        const temporary = `${secretsFile}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(temporary, JSON.stringify({ version: 1, ciphertext }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          await fs.rename(temporary, secretsFile);
        } finally { await fs.rm(temporary, { force: true }); }
      } else await fs.rm(secretsFile, { force: true });
      session = { auth: value.auth, account: value.account, remembered };
      pending = null;
      plan?.controller.abort();
      plan = null;
      generation += 1;
      restoreError = '';
      return { connected: true, account: session.account, remembered };
    } finally { busy = false; }
  }

  async function disconnect() {
    await restore();
    ensureIdle();
    await fs.rm(secretsFile, { force: true });
    plan?.controller.abort();
    session = pending = plan = null;
    generation += 1;
    restoreError = '';
    return { connected: false };
  }

  async function playlists() {
    const active = await connection();
    const result = await bridge({ action: 'playlists', auth: active.auth });
    if (session !== active) throw fail('The YouTube Music account changed. Load playlists again.', 409);
    return result;
  }

  async function importPlaylist(input) {
    const active = await connection();
    ensureIdle();
    busy = true;
    try {
      const remote = await bridge({ action: 'playlist', auth: active.auth, id: playlistId(input.id) }, { timeout: 5 * 60_000 });
      const songs = remote.songs.map((song) => ({ artist: clean(song.artist), title: clean(song.title) }));
      const imported = await storage.importSongs({ file: input.file, name: clean(input.name) || clean(remote.name), description: clean(remote.description).slice(0, 1000), songs });
      return { ...imported, skipped: remote.skipped || 0 };
    } finally { busy = false; }
  }

  function publicPlan(value, { summary = false } = {}) {
    return { id: value.id, name: value.name, account: value.account, status: value.status, completed: value.completed,
      total: value.rows.length, error: value.error || '', ...(!summary ? { rows: value.rows } : {}),
      ...(value.result ? { result: value.result } : {}) };
  }

  function currentPlan(id) {
    if (!plan || id !== plan.id || plan.expires < now() || plan.generation !== generation) throw fail('Export preview expired. Prepare the playlist again.', 409);
    return plan;
  }

  async function prepareExport(input) {
    const active = await connection();
    ensureIdle();
    if (plan?.status === 'matching') throw fail('Close the current export preview before preparing another.', 409);
    const directory = storage.getPlaylistsDirectory();
    const source = exportSource(await storage.getLibrary(), input.file);
    ensureIdle();
    if (plan?.status === 'matching') throw fail('Close the current export preview before preparing another.', 409);
    if (session !== active) throw fail('The YouTube Music account changed. Prepare the export again.', 409);
    if (storage.getPlaylistsDirectory() !== directory) throw fail('The playlist folder changed. Prepare the export again.', 409);
    const value = { ...source, id: randomUUID(), file: input.file, directory, generation,
      expires: now() + 30 * 60_000, status: 'matching', completed: 0, account: active.account,
      controller: new AbortController(), automatic: input.automatic === true,
      rows: source.tracks.map((song, index) => ({ index, ...song, candidates: [], selected: '', error: '' })) };
    plan = value;
    // Deduplicate queries, reuse a Python/API instance for each batch, and bound
    // concurrency. Progress contains metadata only, never authentication headers.
    (async () => {
      const queries = new Map();
      for (const row of value.rows) {
        const query = [row.artist, row.title].filter(Boolean).join(' ');
        if (!queries.has(query)) queries.set(query, []);
        queries.get(query).push(row);
      }
      const batches = [];
      const unique = [...queries.keys()];
      for (let offset = 0; offset < unique.length; offset += 25) batches.push(unique.slice(offset, offset + 25));
      let next = 0;
      const processed = new Set();
      const isActive = () => plan === value && value.generation === generation && value.status === 'matching';
      const update = (item) => {
        if (!isActive() || !queries.has(item.query) || processed.has(item.query)) return;
        processed.add(item.query);
        for (const row of queries.get(item.query)) {
          row.candidates = candidates(item.matches);
          row.selected = suggested(row, row.candidates);
          row.error = item.error || '';
          value.completed += 1;
        }
        value.expires = now() + 30 * 60_000;
      };
      async function worker() {
        while (next < batches.length && isActive()) {
          const batch = batches[next++];
          try {
            const results = await bridge({ action: 'search_batch', auth: active.auth, queries: batch, progress: true },
              { timeout: 15 * 60_000, signal: value.controller.signal, onProgress: update });
            for (const item of results) update(item);
            for (const query of batch) if (!processed.has(query)) update({ query, error: 'YouTube Music did not return a search response.' });
          } catch (error) {
            for (const query of batch) update({ query, error: error.message });
          }
        }
      }
      await Promise.all([worker(), worker()]);
      if (!isActive()) return;
      value.status = 'ready';
      if (value.automatic) await exportPlaylist({ id: value.id });
    })().catch((error) => {
      if (value.status !== 'cancelled') { value.status = 'failed'; value.error = error.message || 'Could not export this playlist.'; }
    });
    return publicPlan(value, { summary: value.automatic });
  }

  function getExport(id, options) { return publicPlan(currentPlan(id), options); }

  function cancelExport(id) {
    const value = currentPlan(id);
    if (value.status === 'exporting') throw fail('The export has already started. Wait for it to finish.', 409);
    value.status = 'cancelled';
    value.controller.abort();
    plan = null;
    return { cancelled: true };
  }

  async function searchRow(input) {
    const active = await connection();
    const value = currentPlan(input.id);
    if (value.status !== 'ready') throw fail('Wait until song matching finishes.', 409);
    const row = value.rows[input.index];
    if (!row || !Number.isInteger(input.index)) throw fail('Choose a valid song.');
    const query = clean(input.query);
    if (!query || query.length > 500) throw fail('Enter a song search of up to 500 characters.');
    const found = candidates(await bridge({ action: 'search', auth: active.auth, query }));
    if (plan !== value || value.status !== 'ready') throw fail('This export is no longer open.', 409);
    row.candidates = found;
    row.error = '';
    row.selected = suggested(row, found);
    return { row };
  }

  async function exportPlaylist(input) {
    const active = await connection();
    ensureIdle();
    const value = currentPlan(input.id);
    if (value.status !== 'ready') throw fail('This export is not ready or has already been submitted.', 409);
    const selections = input.selections === undefined ? value.rows.map((row) => row.selected) : input.selections;
    if (!Array.isArray(selections) || selections.length !== value.rows.length) throw fail('Select a match or skip for every song.');
    const ids = [];
    selections.forEach((id, index) => {
      if (id === '') return;
      if (typeof id !== 'string' || !value.rows[index].candidates.some((candidate) => candidate.id === id)) throw fail('Choose a song from the preview results.');
      ids.push(id);
    });
    const source = exportSource(await storage.getLibrary(), value.file);
    if (storage.getPlaylistsDirectory() !== value.directory || source.fingerprint !== value.fingerprint) {
      throw fail('The playlist changed after this preview. Prepare the export again.', 409);
    }
    ensureIdle();
    if (session !== active || plan !== value || value.status !== 'ready') throw fail('This export is no longer open.', 409);
    busy = true;
    value.status = 'exporting';
    value.expires = now() + 30 * 60_000;
    try {
      const result = ids.length ? await bridge({ action: 'create', auth: active.auth, name: value.name, description: value.description, ids }, { timeout: 15 * 60_000 })
        : { complete: true, added: 0 };
      value.status = 'finished';
      value.result = { ...result, matched: ids.length, skipped: value.rows.length - ids.length,
        url: result.id ? `https://music.youtube.com/playlist?list=${encodeURIComponent(result.id)}` : '',
        rows: value.rows.map((row, index) => {
          const match = row.candidates.find((item) => item.id === selections[index]) || null;
          return { index, artist: row.artist, title: row.title, origin: row.origin, match,
            status: match ? result.complete ? 'exported' : 'unverified' : row.error ? 'search-failed' : row.candidates.length ? 'skipped' : 'not-found',
            reason: match ? '' : row.error || (row.candidates.length ? 'Skipped' : 'No search result') };
        }) };
      return value.result;
    } catch (error) {
      value.status = 'failed'; // Never retry a possibly successful remote write automatically.
      throw error;
    } finally { busy = false; }
  }

  function close() { if (plan?.status === 'matching') { plan.status = 'cancelled'; plan.controller.abort(); } pending = null; shutdown.abort(); }
  return { status, previewConnection, acceptConnection, disconnect, playlists, importPlaylist, prepareExport, getExport, cancelExport, searchRow, exportPlaylist, close };
}

module.exports = { createYouTubeService, playlistId, exportSource, suggested };
