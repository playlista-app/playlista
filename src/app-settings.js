const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const SETTINGS_FILE = path.resolve(process.env.PLAYLISTA_SETTINGS_FILE || path.join(__dirname, '..', 'data', 'app-settings.json'));
const DEFAULT_PLAYLIST_FOLDER = path.resolve(process.env.PLAYLISTA_PLAYLISTS_DIR || path.join(__dirname, '..', 'playlists'));
let current = null;
let persistQueue = Promise.resolve();

function defaults() {
  return {
    playlistDirectory: DEFAULT_PLAYLIST_FOLDER,
    github: { owner: '', repository: '', branch: 'main', login: '', autoSync: false },
    spotify: { clientId: '' },
    syncState: {},
  };
}

async function initialize(store) {
  let value = defaults();
  try {
    const parsed = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
    value = {
      ...value,
      ...parsed,
      github: { ...value.github, ...(parsed.github || {}) },
      spotify: { ...value.spotify, ...(parsed.spotify || {}) },
      syncState: parsed.syncState && typeof parsed.syncState === 'object' ? parsed.syncState : {},
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  delete value.github.folder;
  delete value.syncBase;
  value.github.autoSync = value.github.autoSync === true;
  try {
    await store.setPlaylistsDirectory(value.playlistDirectory);
  } catch (error) {
    value.playlistDirectory = store.getPlaylistsDirectory();
  }
  current = value;
  return publicSettings(store);
}

function getRawSettings() {
  if (!current) current = defaults();
  return current;
}

function publicSettings(store) {
  const value = getRawSettings();
  return {
    playlistDirectory: store.getPlaylistsDirectory(),
    github: {
      owner: value.github.owner || '',
      repository: value.github.repository || '',
      branch: value.github.branch || 'main',
      login: value.github.login || '',
      autoSync: value.github.autoSync === true,
    },
    spotify: { clientId: value.spotify?.clientId || '' },
  };
}

async function saveSettings(input, store) {
  const playlistDirectory = String(input.playlistDirectory || '').trim();
  if (!path.isAbsolute(playlistDirectory)) throw Object.assign(new Error('Playlist folder must be an absolute path.'), { statusCode: 400 });
  const githubInput = input.github && typeof input.github === 'object' ? input.github : {};
  const spotifyInput = input.spotify && typeof input.spotify === 'object' ? input.spotify : {};
  const clientId = String(spotifyInput.clientId || '').trim();
  if (clientId && !/^[A-Za-z0-9]{20,128}$/.test(clientId)) {
    throw Object.assign(new Error('Spotify Client ID must contain 20–128 letters or numbers.'), { statusCode: 400 });
  }
  const owner = String(githubInput.owner || '').trim();
  const repository = String(githubInput.repository || '').trim();
  const branch = String(githubInput.branch || 'main').trim();
  if (owner && !/^[A-Za-z0-9-]+$/.test(owner)) throw Object.assign(new Error('GitHub owner contains unsupported characters.'), { statusCode: 400 });
  if (repository && !/^[A-Za-z0-9._-]+$/.test(repository)) throw Object.assign(new Error('Repository contains unsupported characters.'), { statusCode: 400 });
  if (!branch || /[\s~^:?*\[]|\.\.|\/$/.test(branch)) throw Object.assign(new Error('Enter a valid Git branch name.'), { statusCode: 400 });

  await store.setPlaylistsDirectory(playlistDirectory);
  const value = getRawSettings();
  value.playlistDirectory = path.resolve(playlistDirectory);
  value.github = { login: value.github.login, owner, repository, branch, autoSync: githubInput.autoSync === true };
  value.spotify = { ...value.spotify, clientId };
  await persist();
  return publicSettings(store);
}

async function selectGithubLogin(login) {
  const value = getRawSettings();
  value.github.login = login;
  await persist();
  return value.github.login;
}

async function updateSyncState(key, state) {
  const value = getRawSettings();
  value.syncState = { ...value.syncState, [key]: state };
  await persist();
}

function persist() {
  const saved = persistQueue.catch(() => {}).then(async () => {
    await fs.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
    const temporary = `${SETTINGS_FILE}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(getRawSettings(), null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temporary, SETTINGS_FILE);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  });
  persistQueue = saved;
  return saved;
}

module.exports = { initialize, getRawSettings, publicSettings, saveSettings, selectGithubLogin, updateSyncState };
