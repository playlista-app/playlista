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
    github: { owner: '', repository: '', branch: '', login: '', autoSync: false },
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
      syncState: parsed.syncState && typeof parsed.syncState === 'object' ? parsed.syncState : {},
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  delete value.github.folder;
  delete value.syncBase;
  delete value.spotify;
  if (value.github.owner && value.github.owner.toLowerCase() === value.github.login?.toLowerCase()) value.github.owner = '';
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
      branch: value.github.branch || '',
      login: value.github.login || '',
      autoSync: value.github.autoSync === true,
    },
  };
}

async function saveSettings(input, store) {
  const playlistDirectory = String(input.playlistDirectory || '').trim();
  if (!path.isAbsolute(playlistDirectory)) throw Object.assign(new Error('Playlist folder must be an absolute path.'), { statusCode: 400 });
  const githubInput = input.github && typeof input.github === 'object' ? input.github : {};
  const owner = String(githubInput.owner || '').trim();
  const repository = String(githubInput.repository || '').trim();
  const branch = String(githubInput.branch || '').trim();
  if (owner && !/^[A-Za-z0-9-]+$/.test(owner)) throw Object.assign(new Error('GitHub owner contains unsupported characters.'), { statusCode: 400 });
  if (repository && !/^[A-Za-z0-9._-]+$/.test(repository)) throw Object.assign(new Error('Repository contains unsupported characters.'), { statusCode: 400 });
  if (branch && /[\s~^:?*\[]|\.\.|\/$/.test(branch)) throw Object.assign(new Error('Enter a valid Git branch name.'), { statusCode: 400 });

  await store.setPlaylistsDirectory(playlistDirectory);
  const value = getRawSettings();
  value.playlistDirectory = path.resolve(playlistDirectory);
  value.github = { login: value.github.login, owner, repository, branch, autoSync: githubInput.autoSync === true };
  delete value.spotify;
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
