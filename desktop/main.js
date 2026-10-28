const { app, BrowserWindow, dialog, Menu, protocol, safeStorage, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createDesktopEncryption } = require('./credentials');
const { APP_URL, isAppUrl, isExternalUrl, createProtocolHandler } = require('./protocol');

app.setName('Playlista');
app.setAppUserModelId('app.playlista.desktop');
const smokeTest = process.argv.includes('--smoke-test');
if (smokeTest && !process.env.PLAYLISTA_DESKTOP_DATA_DIR) throw new Error('Smoke tests require an isolated PLAYLISTA_DESKTOP_DATA_DIR.');
const dataDirectory = path.resolve(process.env.PLAYLISTA_DESKTOP_DATA_DIR || path.join(app.getPath('appData'), app.isPackaged ? 'Playlista' : 'Playlista Development'));
require('node:fs').mkdirSync(dataDirectory, { recursive: true });
app.setPath('userData', dataDirectory);
protocol.registerSchemesAsPrivileged([{ scheme: 'playlista', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

let running;
let window;
let shuttingDown = false;
let exitCode = 0;
const ownsLock = app.requestSingleInstanceLock();
if (!ownsLock) app.quit();
else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    const finish = () => app.exit(exitCode);
    if (!running) return finish();
    // Let local writes and an active sync finish before leaving the process.
    const deadline = setTimeout(() => app.exit(1), 35000);
    running.close().then(() => { clearTimeout(deadline); finish(); }, () => { clearTimeout(deadline); app.exit(1); });
  });
  app.whenReady().then(start).catch(async (error) => {
    exitCode = 1;
    if (smokeTest) await fs.writeFile(path.join(dataDirectory, 'smoke-result.json'), JSON.stringify({ error: error.message })).catch(() => {});
    else dialog.showErrorBox('Playlista could not start', error.message);
    app.quit();
  });
}

async function start() {
  if (process.platform !== 'win32') {
    // Finder and desktop launchers often omit Homebrew/user-installed tools.
    process.env.PATH = [...new Set([path.join(app.getPath('home'), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/home/linuxbrew/.linuxbrew/bin', ...(process.env.PATH || '').split(path.delimiter)])].join(path.delimiter);
  }
  // Set paths before importing the backend: its modules capture these at load time.
  process.env.PLAYLISTA_SETTINGS_FILE ||= path.join(dataDirectory, 'app-settings.json');
  process.env.PLAYLISTA_TAG_METADATA_FILE ||= path.join(dataDirectory, 'tag-metadata.json');
  process.env.PLAYLISTA_PLAYLISTS_DIR ||= app.isPackaged && !process.env.PLAYLISTA_DESKTOP_DATA_DIR
    ? path.join(app.getPath('documents'), 'Playlista', 'playlists') : path.join(dataDirectory, 'playlists');
  if (app.isPackaged) process.env.PLAYLISTA_HELPERS_DIR = path.join(process.resourcesPath, 'helpers');
  await fs.mkdir(process.env.PLAYLISTA_PLAYLISTS_DIR, { recursive: true });
  const { startServer } = require('../src/server');
  running = await startServer({ port: 0, encryption: createDesktopEncryption(safeStorage) });
  const origin = `http://127.0.0.1:${running.address.port}`;
  // A stable app origin keeps sidebar preferences across random backend ports.
  protocol.handle('playlista', createProtocolHandler(origin));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  window = new BrowserWindow({
    title: 'Playlista', width: 1280, height: 850, minWidth: 740, minHeight: 520,
    backgroundColor: '#f5f6f3', show: false,
    icon: path.join(__dirname, '../build/icons/icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  const openExternal = (url) => {
    if (isExternalUrl(url)) shell.openExternal(url).catch(() => {});
  };
  window.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) { event.preventDefault(); openExternal(url); }
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('app-command', (_event, command) => {
    const history = window.webContents.navigationHistory;
    if (command === 'browser-backward' && history.canGoBack()) history.goBack();
    if (command === 'browser-forward' && history.canGoForward()) history.goForward();
  });
  window.on('closed', () => { window = null; });
  window.once('ready-to-show', () => { if (!smokeTest) window.show(); });
  await window.loadURL(APP_URL);
  if (smokeTest) {
    const result = await window.webContents.executeJavaScript(`(async () => {
      const json = async (url, body) => {
        const response = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
        if (!response.ok) throw new Error(url + ': ' + response.status);
        return response.json();
      };
      const settings = await json('/api/settings');
      const created = await json('/api/playlists', { name: 'Desktop smoke test' });
      const library = await json('/api/library');
      const youtube = await json('/api/youtube/status');
      const spotify = await json('/api/spotify/status');
      if (!library.playlists.some(p => p.name === 'Desktop smoke test')) throw new Error('Playlist write did not persist.');
      return { title: document.title, origin: location.origin, rendererHasNode: typeof require !== 'undefined',
        playlistDirectory: settings.playlistDirectory, youtube: youtube.runtime, spotify: spotify.runtime };
    })()`);
    result.backendPort = running.address.port;
    result.packaged = app.isPackaged;
    await fs.writeFile(path.join(dataDirectory, 'smoke-result.json'), JSON.stringify(result));
    app.quit();
  }
}
