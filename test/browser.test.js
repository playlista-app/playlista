const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { serializePlaylist } = require('../src/format');

const browserExecutable = process.env.PLAYLISTA_BROWSER_EXE || (process.platform === 'win32'
  ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync)
  : null);

async function until(action, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await action();
    if (result) return result;
    await delay(40);
  }
  throw new Error('Timed out waiting for the browser.');
}

async function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const errors = [];
  let id = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(`Browser connection closed during ${request.method}.`));
    }
    pending.clear();
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  function send(method, params = {}) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Browser command timed out: ${method}`)); }, 5000);
      pending.set(requestId, { resolve, reject, timer, method });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });
  }
  return {
    send, errors, close: () => socket.close(),
    async evaluate(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    async key(key, code, windowsVirtualKeyCode) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key.length === 1 ? { text: key } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
    },
  };
}

test('playlist controls remain usable while scrolling, typing, searching and syncing', {
  skip: !browserExecutable || typeof WebSocket === 'undefined' ? 'Set PLAYLISTA_BROWSER_EXE and use Node 22+ for browser checks.' : false,
  timeout: 30000,
}, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-browser-'));
  const libraryDirectory = path.join(directory, 'library');
  const profile = path.join(directory, 'browser');
  await fs.mkdir(libraryDirectory);
  const overrides = {
    PLAYLISTA_PLAYLISTS_DIR: libraryDirectory,
    PLAYLISTA_SETTINGS_FILE: path.join(directory, 'settings.json'),
    PLAYLISTA_TAG_METADATA_FILE: path.join(directory, 'tags.json'),
  };
  const previous = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  const fixture = serializePlaylist({ name: 'Punk', created: new Date(Date.now() - 24 * 3600000).toISOString(), updated: new Date(Date.now() - 2 * 3600000).toISOString() });
  await fs.writeFile(path.join(libraryDirectory, 'punk.lista'), fixture + Array.from({ length: 60 }, (_, index) => `Artist ${index} > Song ${index}`).join('\n') + '\n');
  for (let index = 0; index < 36; index += 1) {
    const text = serializePlaylist({ name: `Shelf ${String(index).padStart(2, '0')}`, created: new Date().toISOString(), updated: new Date().toISOString() });
    await fs.writeFile(path.join(libraryDirectory, `shelf-${index}.lista`), text);
  }
  let server;
  let browser;
  let client;
  let stage = 'launch';
  let browserLog = '';
  const youtubeCalls = [];
  try {
    const youtube = require('../src/youtube').createYouTubeService({
      credentialFile: path.join(directory, 'youtube.json'), platform: 'win32',
      bridge: async (input) => {
        youtubeCalls.push(input);
        if (input.action === 'probe') return { version: 'test' };
        if (input.action === 'connect') return { auth: { cookie: 'synthetic-only' }, account: { name: 'Personal test', handle: '@personal' } };
        if (input.action === 'seal') return 'encrypted-test-value';
        if (input.action === 'playlists') return [{ id: 'PLimport', name: 'Imported playlist', count: '4' }, { id: 'PLlarge', name: 'Large import', count: '1000' }];
        if (input.action === 'playlist' && input.id === 'PLlarge') return { name: 'Large import', songs: Array.from({ length: 1000 }, () => ({ title: 'Basket Case' })), skipped: 0 };
        if (input.action === 'playlist') return { name: 'Imported playlist', description: 'Imported description', songs: [
          { artist: 'Sum 41', title: 'In Too Deep' }, { artist: 'Sum 41', title: 'In Too Deep' },
          { title: 'Basket Case' }, { title: 'Unknown' },
        ], skipped: 1 };
        if (input.action === 'search_batch') return input.queries.map((query) => ({ query,
          matches: query === 'Unknown' ? [] : query === 'Basket Case' ? [{ id: 'mnopqrstuvw', title: 'Basket Case', artist: 'Green Day' }]
            : [{ id: 'abcdefghijk', artist: 'Sum 41', title: 'In Too Deep' }] }));
        if (input.action === 'create') return { id: 'PLcreated', complete: true, added: input.ids.length };
        throw new Error(`Unexpected ${input.action}`);
      },
    });
    const running = await require('../src/server').startServer({ port: 0, youtube });
    server = running.server;
    browser = spawn(browserExecutable, ['--headless=new', '--disable-gpu', '--in-process-gpu', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    browser.stderr.on('data', (chunk) => { browserLog = (browserLog + chunk).slice(-3000); });
    let launchError;
    browser.once('error', (error) => { launchError = error; });
    const debuggingPort = await until(async () => {
      if (launchError) throw launchError;
      return fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').then((value) => Number(value.split('\n')[0])).catch(() => null);
    });
    const target = await until(async () => (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`).then((response) => response.json())).find((item) => item.type === 'page'));
    client = await connect(target.webSocketDebuggerUrl);
    stage = 'load';
    await client.send('Runtime.enable');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.navigate', { url: `http://127.0.0.1:${running.address.port}` });
    await until(() => client.evaluate('Boolean(document.querySelector("#playlistTree .tree-button"))'));
    await client.evaluate('document.querySelector("#playlistTree .tree-button").click()');
    assert.equal(await client.evaluate('document.querySelector("#addSongHeading").textContent'), 'Quick add');
    assert.equal(await client.evaluate('document.querySelector(".playlist-name-row #songCount").textContent'), '60');
    assert.equal(await client.evaluate('document.querySelector("#songsHeading").textContent'), 'Playlist tracks');
    assert.match(await client.evaluate('document.querySelector("#playlistMeta").textContent'), /Created 1 day ago/);
    assert.match(await client.evaluate('document.querySelector("#playlistMeta").textContent'), /Updated 2 hours ago/);
    assert.equal(await client.evaluate('document.querySelector("#playlistSyncButton").hidden'), false);
    stage = 'independent sidebar scrolling';
    await client.evaluate('window.scrollTo(0, 1500)');
    await delay(100);
    const navigation = await client.evaluate(`(() => {
      const box = (selector) => { const rect = document.querySelector(selector).getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, height: rect.height }; };
      const tree = document.querySelector('#playlistTree');
      return { header: box('.topbar'), sidebar: box('.sidebar'), resizer: box('#sidebarResizer'), overview: box('#homeButton'), settings: box('#settingsButton'), scrollable: tree.scrollHeight > tree.clientHeight };
    })()`);
    assert.equal(navigation.header.top, 0);
    assert.equal(navigation.sidebar.top, navigation.header.bottom);
    assert.equal(navigation.sidebar.bottom, 800);
    assert.ok(navigation.overview.top >= navigation.header.bottom);
    assert.ok(navigation.settings.bottom <= 800);
    assert.equal(navigation.resizer.height, navigation.sidebar.height);
    assert.equal(navigation.scrollable, true);
    const sidebarScrollPosition = await client.evaluate('window.scrollY');
    const treePoint = await client.evaluate('(() => { const rect = document.querySelector("#playlistTree").getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()');
    await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...treePoint, deltaX: 0, deltaY: 300 });
    await until(() => client.evaluate('document.querySelector("#playlistTree").scrollTop > 0'));
    assert.equal(await client.evaluate('window.scrollY'), sidebarScrollPosition);
    await client.evaluate('document.querySelector("#playlistTree").scrollTop = document.querySelector("#playlistTree").scrollHeight');
    await client.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...treePoint, deltaX: 0, deltaY: 300 });
    await delay(100);
    assert.equal(await client.evaluate('window.scrollY'), sidebarScrollPosition, 'scrolling past the sidebar end must not scroll the song list');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 360, deviceScaleFactor: 1, mobile: false });
    await delay(50);
    assert.equal(await client.evaluate('document.querySelector("#settingsButton").getBoundingClientRect().bottom <= innerHeight'), true);
    assert.equal(await client.evaluate('document.querySelector("#homeButton").getBoundingClientRect().top >= document.querySelector(".topbar").getBoundingClientRect().bottom'), true);
    assert.equal(await client.evaluate('document.querySelector("#playlistTree").clientHeight > 0'), true);
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    stage = 'sticky composer';
    await client.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await delay(100);
    const top = await client.evaluate('document.querySelector(".song-composer").getBoundingClientRect().top');
    assert.ok(Math.abs(top - 80) < 2, `sticky composer top: ${top}`);
    const scroll = await client.evaluate('window.scrollY');
    stage = 'typing';
    await client.evaluate('document.activeElement.blur()');
    await client.key('S', 'KeyS', 83);
    assert.equal(await client.evaluate('document.activeElement.value'), 'S');
    assert.equal(await client.evaluate('document.activeElement.dataset.property'), 'song');
    assert.ok(Math.abs(await client.evaluate('window.scrollY') - scroll) < 2, 'typing should not jump back to the playlist top');
    await client.key('u', 'KeyU', 85);
    assert.equal(await client.evaluate('document.activeElement.value'), 'Su');
    await client.key('Tab', 'Tab', 9);
    assert.equal(await client.evaluate('document.activeElement.dataset.property'), 'artist');
    await client.key('G', 'KeyG', 71);
    assert.equal(await client.evaluate('document.activeElement.value'), 'G');
    stage = 'search and dialog';
    await client.evaluate('document.querySelector("#librarySearchInput").focus()');
    await client.key('q', 'KeyQ', 81);
    assert.equal(await client.evaluate('document.activeElement.id'), 'librarySearchInput');
    assert.equal(await client.evaluate('composer.song'), 'Su');
    await client.evaluate('document.querySelector("#clearLibrarySearch").click(); document.querySelector("#playlistEditButton").click()');
    await client.key('X', 'KeyX', 88);
    assert.equal(await client.evaluate('document.activeElement.closest("dialog").id'), 'editPlaylistDialog');
    assert.equal(await client.evaluate('composer.song'), 'Su');
    await client.evaluate('document.querySelector("#editPlaylistDialog").close(); document.querySelector("#playlistSyncButton").click()');
    await until(() => client.evaluate('!document.querySelector("#settingsView").hidden'));
    stage = 'sync';
    await client.evaluate(`
      goToPlaylist('punk.lista');
      window.__testSync = { ...syncStatus, configured: true, pendingFiles: 1, activity: '', scheduled: false, files: [{ file: 'punk.lista', status: 'local-changed', changes: 1 }] };
      applySyncStatus(window.__testSync);
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (url, options) => {
        if (url === '/api/github/sync') {
          window.__syncRequest = JSON.parse(options.body);
          window.__testSync = { ...window.__testSync, pendingFiles: 0, files: [{ file: 'punk.lista', status: 'synced', changes: 0, syncedAt: new Date().toISOString() }] };
          return new Response(JSON.stringify({ library, tags: tagRegistry, sync: window.__testSync, conflicts: [] }));
        }
        if (url === '/api/github/status') return new Response(JSON.stringify(window.__testSync));
        return originalFetch(url, options);
      };
      document.querySelector('#playlistSyncButton').click();
    `);
    await until(() => client.evaluate('document.querySelector("#playlistSyncButton").hidden'));
    assert.deepEqual(await client.evaluate('window.__syncRequest'), { direction: 'both', file: 'punk.lista' });
    assert.match(await client.evaluate('document.querySelector(".playlist-sync-status").textContent'), /Synced to GitHub at/);
    stage = 'mobile';
    await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await client.evaluate('window.scrollTo(0, document.body.scrollHeight)');
    await delay(100);
    assert.ok(Math.abs(await client.evaluate('document.querySelector(".song-composer").getBoundingClientRect().top') - 12) < 2);
    assert.equal(await client.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
    stage = 'YouTube account preview';
    await client.evaluate('goToSettings()');
    await until(() => client.evaluate('document.querySelector("#youtubeConnectionDetails").open'));
    await client.evaluate('document.querySelector("#youtubeHeadersInput").value = "synthetic headers"; document.querySelector("#youtubeCheckButton").click()');
    await until(() => client.evaluate('!document.querySelector("#youtubeAccountPreview").hidden'));
    assert.equal(await client.evaluate('document.querySelector("#youtubeHeadersInput").value'), '');
    assert.match(await client.evaluate('document.querySelector("#youtubePreviewName").textContent'), /Personal test.*@personal/);
    assert.equal(await client.evaluate('document.querySelector("#youtubeImportControls").hidden'), true);
    await client.evaluate('document.querySelector("#youtubeAcceptButton").click()');
    await until(() => client.evaluate('!document.querySelector("#youtubeImportControls").hidden'));
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'youtube.json'), 'utf8')).ciphertext, 'encrypted-test-value');
    stage = 'YouTube import';
    await client.evaluate('document.querySelector("#youtubeLoadButton").click()');
    await until(() => client.evaluate('Boolean(document.querySelector("#youtubePlaylistList button"))'));
    const importHistory = await client.evaluate('appNavigationIndex');
    await client.evaluate('document.querySelector("#youtubePlaylistList button").click()');
    await until(() => client.evaluate('Boolean(library.playlists.find(p => p.name === "Imported playlist"))'));
    assert.equal(await client.evaluate('document.querySelector("#settingsView").hidden'), false);
    assert.equal(await client.evaluate('appNavigationIndex'), importHistory);
    assert.equal(await client.evaluate('library.playlists.find(p => p.name === "Imported playlist").songs.length'), 4);
    assert.equal(await client.evaluate('[...document.querySelectorAll(".tree-button.is-imported")].some(b => b.textContent.includes("Imported playlist"))'), true);
    await until(() => client.evaluate('!document.querySelectorAll("#youtubePlaylistList button")[1].disabled'));
    await client.evaluate('document.querySelectorAll("#youtubePlaylistList button")[1].click()');
    await until(() => client.evaluate('Boolean(library.playlists.find(p => p.name === "Large import"))'));
    assert.equal(await client.evaluate('document.querySelector("#settingsView").hidden'), false);
    assert.equal(await client.evaluate('appNavigationIndex'), importHistory);
    stage = 'YouTube automatic export results';
    await client.evaluate('goToPlaylist(library.playlists.find(p => p.name === "Imported playlist").id); document.querySelector("#youtubeExportButton").click()');
    await until(() => client.evaluate('!document.querySelector("#youtubeExportView").hidden && !document.querySelector("#youtubeExportResult").hidden'));
    assert.equal(await client.evaluate('document.querySelectorAll(".youtube-export-row").length'), 4);
    assert.equal(await client.evaluate('document.querySelectorAll(".youtube-match-select").length'), 0);
    assert.match(await client.evaluate('document.querySelector("#youtubeExportStats").textContent'), /3Exported.*1Skipped/);
    assert.match(await client.evaluate('document.querySelector("#youtubeExportRows").textContent'), /Basket Case.*Green Day/);
    await client.evaluate('document.querySelector("#youtubeExportFilter").value = "skipped"; document.querySelector("#youtubeExportFilter").dispatchEvent(new Event("change"))');
    assert.equal(await client.evaluate('document.querySelectorAll(".youtube-export-row").length'), 1);
    assert.match(await client.evaluate('document.querySelector("#youtubeExportRows").textContent'), /Unknown.*Not found/);
    assert.equal(await client.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
    assert.deepEqual(youtubeCalls.find((call) => call.action === 'create').ids, ['abcdefghijk', 'abcdefghijk', 'mnopqrstuvw']);
    assert.equal(await client.evaluate('document.querySelector("#youtubeExportResult a").href'), 'https://music.youtube.com/playlist?list=PLcreated');
    stage = 'YouTube export history navigation';
    await client.evaluate('history.back()');
    await until(() => client.evaluate('!document.querySelector("#playlistView").hidden'));
    await client.evaluate('history.forward()');
    await until(() => client.evaluate('!document.querySelector("#youtubeExportView").hidden'));
    assert.match(await client.evaluate('document.querySelector("#youtubeExportRows").textContent'), /Unknown.*Not found/);
    stage = 'thousand-song results pagination';
    await client.evaluate('goToPlaylist(library.playlists.find(p => p.name === "Large import").id); document.querySelector("#youtubeExportButton").click()');
    await until(() => client.evaluate('!document.querySelector("#youtubeExportView").hidden && !document.querySelector("#youtubeExportResult").hidden && document.querySelector("#youtubeExportHeading").textContent === "Large import"'));
    assert.equal(await client.evaluate('document.querySelectorAll(".youtube-export-row").length'), 50);
    assert.equal(await client.evaluate('document.querySelector("#youtubeExportPage").textContent'), '1 / 20');
    await client.evaluate('document.querySelector("#youtubeExportNext").click()');
    assert.match(await client.evaluate('document.querySelector(".youtube-export-row").textContent'), /^51\./);
    assert.equal(await client.evaluate('document.querySelectorAll(".youtube-export-row").length'), 50);
    assert.equal(youtubeCalls.filter((call) => call.action === 'create').at(-1).ids.length, 1000);
    assert.deepEqual(client.errors, []);
  } catch (error) {
    error.message = `${stage}: ${error.message}\n${browserLog}`;
    throw error;
  } finally {
    if (client) {
      await client.send('Browser.close').catch(() => {});
      client.close();
    }
    if (browser && browser.exitCode === null) {
      await until(() => browser.exitCode !== null || browser.signalCode !== null, 3000).catch(async () => {
        if (process.platform === 'win32') await promisify(execFile)('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
        else browser.kill('SIGKILL');
      });
    }
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('playlista-browser-'));
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
