const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const store = require('./store');
const appSettings = require('./app-settings');
const { parsePlaylistText, validateCollection } = require('./format');

const execFileAsync = promisify(execFile);
const API_ROOT = 'https://api.github.com';

function contentHash(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function countChanges(before = '', after = '') {
  if (!before || !after) return before === after ? 0 : 1;
  const lines = (text) => text.replace(/\r\n/g, '\n').split('\n')
    .map((line) => line.trim()).filter((line) => line && !/^(created|updated)\s*:/i.test(line));
  const previous = lines(before);
  const current = lines(after);
  if (JSON.stringify(previous) === JSON.stringify(current)) return before === after ? 0 : 1;
  const balance = new Map();
  for (const line of previous) balance.set(line, (balance.get(line) || 0) - 1);
  for (const line of current) balance.set(line, (balance.get(line) || 0) + 1);
  let added = 0;
  let removed = 0;
  for (const value of balance.values()) {
    if (value > 0) added += value;
    else removed -= value;
  }
  return Math.max(added, removed, 1);
}

async function listAccounts() {
  try {
    let stdout;
    try {
      ({ stdout } = await execFileAsync('gh', ['auth', 'status', '--hostname', 'github.com', '--json', 'hosts'], { timeout: 5000, windowsHide: true }));
    } catch (error) {
      stdout = error.stdout;
      if (!stdout?.trim()) throw error;
    }
    const parsed = JSON.parse(stdout);
    const accounts = (parsed.hosts?.['github.com'] || [])
      .filter((account) => account.login && account.state === 'success')
      .map((account) => ({ login: account.login, active: account.active === true }));
    return { accounts, selected: appSettings.getRawSettings().github.login || '' };
  } catch {
    throw Object.assign(new Error('Could not read GitHub CLI accounts. Install gh, then run gh auth login.'), { statusCode: 400 });
  }
}

async function selectAccount(login) {
  if (typeof login !== 'string' || !login.trim()) throw Object.assign(new Error('Choose a GitHub account.'), { statusCode: 400 });
  const { accounts } = await listAccounts();
  const account = accounts.find((item) => item.login.toLowerCase() === login.trim().toLowerCase());
  if (!account) throw Object.assign(new Error('That account is no longer authenticated. Reload accounts and try again.'), { statusCode: 409 });
  await appSettings.selectGithubLogin(account.login);
  return { login: account.login, active: account.active };
}

async function getToken(login) {
  if (!login) throw Object.assign(new Error('Choose which GitHub account Playlista should use.'), { statusCode: 401 });
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token', '--hostname', 'github.com', '--user', login], { timeout: 5000, windowsHide: true });
    if (stdout.trim()) return stdout.trim();
  } catch {}
  throw Object.assign(new Error(`GitHub CLI no longer has a usable login for ${login}. Select an authenticated account in Settings.`), { statusCode: 401 });
}

async function githubRequest(url, options = {}, login) {
  const token = await getToken(login);
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(20000),
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'Playlista local app',
      'x-github-api-version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.json().then((value) => value.message || '').catch(() => '');
    const message = response.status === 401 ? 'GitHub authentication expired. Run gh auth login again.'
      : response.status === 403 ? 'GitHub denied access. Check that the selected account has Contents read and write access.'
        : `GitHub request failed (${response.status})${detail ? `: ${detail}` : '.'}`;
    throw Object.assign(new Error(message), { statusCode: response.status === 401 ? 401 : 400, githubStatus: response.status, githubMessage: detail });
  }
  return response.status === 204 ? null : response.json();
}

function createGitHubService({ storage = store, settings = appSettings, request = githubRequest, now = () => new Date().toISOString() } = {}) {
  const blobCache = new Map();
  function configuration(required = false) {
    const github = settings.getRawSettings().github;
    const config = { ...github, directory: storage.getPlaylistsDirectory() };
    if (required && (!config.owner || !config.repository || !config.login)) {
      throw Object.assign(new Error('Set the GitHub owner, repository, and account in Settings first.'), { statusCode: 400 });
    }
    return config;
  }

  function stateKey(config) {
    return JSON.stringify([config.owner.toLowerCase(), config.repository.toLowerCase(), config.branch, config.directory]);
  }

  function loadState(config) {
    return structuredClone(settings.getRawSettings().syncState?.[stateKey(config)] || { files: {}, remote: {}, checkedAt: null });
  }

  function saveState(config, state) {
    return settings.updateSyncState(stateKey(config), state);
  }

  function markSynced(state, file, text) {
    const hash = contentHash(text);
    const previous = state.files[file];
    state.files[file] = { hash, text, syncedAt: previous?.hash === hash ? previous.syncedAt : now() };
    state.remote[file] = hash;
  }

  async function remotePlaylists(config) {
    const repositoryPath = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repository)}`;
    const api = (suffix = '', options) => request(`${API_ROOT}${repositoryPath}${suffix}`, options, config.login);
    const repository = await api();
    let branch;
    try {
      branch = await api(`/branches/${encodeURIComponent(config.branch)}`);
    } catch (error) {
      if (error.githubStatus !== 404 && error.githubStatus !== 409) throw error;
      let branches;
      try {
        branches = await api('/branches?per_page=100');
      } catch (branchError) {
        if (branchError.githubStatus === 409 && /empty/i.test(branchError.githubMessage || branchError.message)) branches = [];
        else throw branchError;
      }
      if (Array.isArray(branches) && branches.length === 0) {
        return { files: new Map(), treeByPath: new Map(), emptyRepository: true, defaultBranch: repository.default_branch || config.branch, api };
      }
      throw Object.assign(new Error(`Branch "${config.branch}" was not found. Available branches: ${branches.map((item) => item.name).join(', ')}.`), { statusCode: 400 });
    }
    const tree = await api(`/git/trees/${encodeURIComponent(branch.commit.commit.tree.sha)}?recursive=1`);
    if (tree.truncated) throw Object.assign(new Error('The GitHub repository is too large to scan completely.'), { statusCode: 400 });
    const files = new Map();
    const treeByPath = new Map();
    for (const entry of tree.tree.filter((item) => item.type === 'blob' && item.path.toLowerCase().endsWith('.lista'))) {
      const relative = entry.path;
      if (/[:\\\0]/.test(relative) || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw Object.assign(new Error(`GitHub contains an unsupported playlist path: ${relative}`), { statusCode: 409 });
      }
      if (!blobCache.has(entry.sha)) {
        const blob = await api(`/git/blobs/${encodeURIComponent(entry.sha)}`);
        blobCache.set(entry.sha, Buffer.from(blob.content.replace(/\n/g, ''), 'base64').toString('utf8'));
      }
      files.set(relative, blobCache.get(entry.sha));
      treeByPath.set(relative, entry);
    }
    return { files, treeByPath, emptyRepository: false, defaultBranch: repository.default_branch, api };
  }

  function observe(state, remote, local) {
    state.remote = Object.fromEntries([...remote.files].map(([file, text]) => [file, contentHash(text)]));
    state.checkedAt = now();
    for (const [file, text] of local) {
      if (state.remote[file] === contentHash(text)) markSynced(state, file, text);
    }
  }

  async function writeRemote(remote, config, file, text) {
    const bootstrap = remote.emptyRepository;
    const body = {
      message: `Playlista: save ${file}`,
      content: Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8').toString('base64'),
    };
    // GitHub's raw Git endpoints cannot initialize an empty repository.
    // The Contents API creates the first commit on its default branch.
    if (!bootstrap) body.branch = config.branch;
    const entry = remote.treeByPath.get(file);
    if (entry) body.sha = entry.sha;
    const result = await remote.api(`/contents/${file.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (bootstrap && remote.defaultBranch !== config.branch) {
      await remote.api('/git/refs', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: `refs/heads/${config.branch}`, sha: result.commit.sha }),
      });
    }
    remote.emptyRepository = false;
    remote.files.set(file, text);
    remote.treeByPath.set(file, { sha: result.content.sha });
  }

  async function getStatus() {
    const config = configuration();
    const state = loadState(config);
    const records = await storage.readPlaylistFiles(config.directory);
    const local = new Map(records.map((record) => [record.file, record.text]));
    const files = [];
    const variants = new Map();
    for (const file of new Set([...local.keys(), ...Object.keys(state.remote)])) {
      const key = file.toLowerCase();
      variants.set(key, (variants.get(key) || 0) + 1);
    }
    for (const file of new Set([...local.keys(), ...Object.keys(state.remote), ...Object.keys(state.files)])) {
      const text = local.get(file);
      const hash = text === undefined ? null : contentHash(text);
      const remoteHash = state.remote[file] || null;
      const baseline = state.files[file];
      if (!hash && !remoteHash) continue;
      let status = 'local-changed';
      if (hash && hash === remoteHash && baseline?.hash === hash) status = 'synced';
      else if (!hash) status = 'remote-only';
      else if (!remoteHash) status = 'local-only';
      else if (hash === baseline?.hash) status = 'remote-changed';
      else if (remoteHash !== baseline?.hash) status = 'conflict';
      if (variants.get(file.toLowerCase()) > 1) status = 'path-conflict';
      files.push({ file, status, changes: status === 'synced' ? 0 : Math.max(1, countChanges(baseline?.text || '', text || '')), syncedAt: baseline?.syncedAt || null });
    }
    const localFingerprint = store.collectionFingerprint(records);
    return {
      configured: Boolean(config.owner && config.repository && config.login),
      autoSync: config.autoSync === true,
      repository: config.owner && config.repository ? `${config.owner}/${config.repository}` : '',
      checkedAt: state.checkedAt,
      pendingFiles: files.filter((file) => file.status !== 'synced').length,
      changes: files.reduce((total, file) => total + file.changes, 0),
      localFingerprint,
      files,
    };
  }

  async function checkStatus() {
    const config = configuration(true);
    const [remote, records] = await Promise.all([remotePlaylists(config), storage.readPlaylistFiles(config.directory)]);
    const state = loadState(config);
    observe(state, remote, new Map(records.map((record) => [record.file, record.text])));
    await saveState(config, state);
    return { connected: true, account: config.login, repository: `${config.owner}/${config.repository}`, playlistFiles: remote.files.size, emptyRepository: remote.emptyRepository };
  }

  async function sync(direction, file) {
    if (!['pull', 'push', 'both', 'auto'].includes(direction)) throw Object.assign(new Error('Unknown sync direction.'), { statusCode: 400 });
    if (file !== undefined && (typeof file !== 'string' || !file)) throw Object.assign(new Error('Choose a playlist to sync.'), { statusCode: 400 });
    const config = configuration(true);
    const [remote, validation] = await Promise.all([remotePlaylists(config), storage.validateDirectory(config.directory)]);
    if (validation.issues.length) throw Object.assign(new Error('Fix playlist validation errors before syncing.'), { statusCode: 409 });
    const local = new Map(validation.records.map((record) => [record.file, record.text]));
    const state = loadState(config);
    observe(state, remote, local);
    const result = { direction, added: 0, updated: 0, unchanged: 0, conflicts: [], notices: [] };
    const imports = [];
    const uploads = [];
    const canPull = direction !== 'push';
    const canPush = direction !== 'pull';
    const allPaths = [...new Set([...local.keys(), ...remote.files.keys()])].sort();
    const selected = new Set(file === undefined ? allPaths : [file]);
    if (file !== undefined) {
      if (!local.has(file) && !remote.files.has(file)) throw Object.assign(new Error('Playlist was not found. Refresh and try again.'), { statusCode: 404 });
      const named = (files) => new Map([...files].map(([path, text]) => [path, parsePlaylistText(text, path).playlist]));
      const localPlaylists = named(local);
      const remotePlaylists = named(remote.files);
      // Include missing ancestors so a new child can be saved or imported on its own.
      for (const path of selected) {
        for (const [source, destination] of [[localPlaylists, remotePlaylists], [remotePlaylists, localPlaylists]]) {
          const parent = source.get(path)?.parent?.toLowerCase();
          if (!parent || [...destination.values()].some((playlist) => playlist.name?.toLowerCase() === parent)) continue;
          const ancestor = [...source].find(([, playlist]) => playlist.name?.toLowerCase() === parent)?.[0];
          if (ancestor) selected.add(ancestor);
        }
      }
    }
    const paths = allPaths.filter((path) => selected.has(path));
    const variants = new Map();
    for (const file of allPaths) {
      const key = file.toLowerCase();
      variants.set(key, [...(variants.get(key) || []), file]);
    }
    for (const file of paths) {
      if (variants.get(file.toLowerCase()).length > 1) {
        result.conflicts.push(file);
        continue;
      }
      const text = local.get(file);
      const remoteText = remote.files.get(file);
      const hash = text === undefined ? null : contentHash(text);
      const remoteHash = remoteText === undefined ? null : contentHash(remoteText);
      const baseline = state.files[file]?.hash;
      if (hash && hash === remoteHash) { result.unchanged += 1; continue; }
      if (!hash) {
        if (canPull) imports.push({ path: file, text: remoteText, expectedText: text });
        else result.notices.push(`${file}: only on GitHub; import to restore locally`);
      } else if (!remoteHash) {
        if (canPush) uploads.push({ path: file, text });
        else result.notices.push(`${file}: only local; save to GitHub to back it up`);
      } else if (baseline && hash === baseline) {
        if (canPull) imports.push({ path: file, text: remoteText, expectedText: text });
        else result.notices.push(`${file}: GitHub has changes; import them first`);
      } else if (baseline && remoteHash === baseline) {
        if (canPush) uploads.push({ path: file, text });
        else result.notices.push(`${file}: local changes have not been saved to GitHub`);
      } else result.conflicts.push(file);
    }
    try {
      if (file !== undefined && uploads.length) {
        const prospective = new Map(remote.files);
        for (const change of uploads) prospective.set(change.path, change.text);
        const issues = validateCollection([...prospective].map(([path, text]) => parsePlaylistText(text, path)));
        if (issues.length) throw Object.assign(new Error(`Sync the related playlist changes together from Settings: ${issues[0].message}`), { statusCode: 409 });
      }
      if (imports.length) {
        await storage.applyPlaylistFiles(imports, config.directory);
        for (const change of imports) {
          result[local.has(change.path) ? 'updated' : 'added'] += 1;
          markSynced(state, change.path, change.text);
        }
      }
      for (const change of uploads) {
        const existed = remote.files.has(change.path);
        await writeRemote(remote, config, change.path, change.text);
        markSynced(state, change.path, change.text);
        result[existed ? 'updated' : 'added'] += 1;
      }
      if (remote.emptyRepository) result.notices.push('The GitHub repository is empty. Add a playlist locally and save to create its first commit.');
      return result;
    } finally {
      await saveState(config, state);
    }
  }

  async function resolveConflicts(direction, paths) {
    if (!['pull', 'push'].includes(direction) || !Array.isArray(paths) || !paths.length || paths.length > 1000 || paths.some((file) => typeof file !== 'string')) {
      throw Object.assign(new Error('Choose conflicting playlist files and a sync direction.'), { statusCode: 400 });
    }
    const config = configuration(true);
    const [remote, records] = await Promise.all([remotePlaylists(config), storage.readPlaylistFiles(config.directory)]);
    const local = new Map(records.map((record) => [record.file, record.text]));
    const state = loadState(config);
    observe(state, remote, local);
    const selected = [...new Set(paths)];
    const changes = selected.map((file) => {
      if (!local.has(file) || !remote.files.has(file)) throw Object.assign(new Error(`Conflict changed: ${file}. Sync again.`), { statusCode: 409 });
      return { path: file, text: direction === 'pull' ? remote.files.get(file) : local.get(file), expectedText: local.get(file) };
    });
    try {
      if (direction === 'pull') {
        await storage.applyPlaylistFiles(changes, config.directory);
        for (const change of changes) markSynced(state, change.path, change.text);
      } else {
        const validation = await storage.validateDirectory(config.directory);
        if (validation.issues.length) throw Object.assign(new Error('Fix playlist validation errors before syncing.'), { statusCode: 409 });
        for (const change of changes) {
          await writeRemote(remote, config, change.path, change.text);
          markSynced(state, change.path, change.text);
        }
      }
      return { resolved: selected, direction };
    } finally { await saveState(config, state); }
  }

  return { getStatus, checkStatus, testConnection: checkStatus, sync, resolveConflicts };
}

module.exports = { ...createGitHubService(), listAccounts, selectAccount, createGitHubService, countChanges };
