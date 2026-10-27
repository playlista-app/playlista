const elements = {
  tree: document.querySelector('#playlistTree'),
  homeButton: document.querySelector('#homeButton'),
  settingsButton: document.querySelector('#settingsButton'),
  sidebarResizer: document.querySelector('#sidebarResizer'),
  homeView: document.querySelector('#homeView'),
  settingsView: document.querySelector('#settingsView'),
  settingsForm: document.querySelector('#settingsForm'),
  playlistDirectoryInput: document.querySelector('#playlistDirectoryInput'),
  spotifyClientIdInput: document.querySelector('#spotifyClientIdInput'),
  spotifyRedirectUri: document.querySelector('#spotifyRedirectUri'),
  spotifyAuthStatus: document.querySelector('#spotifyAuthStatus'),
  spotifyConnectButton: document.querySelector('#spotifyConnectButton'),
  spotifyDisconnectButton: document.querySelector('#spotifyDisconnectButton'),
  spotifyLoadPlaylistsButton: document.querySelector('#spotifyLoadPlaylistsButton'),
  spotifyTargetPlaylistSelect: document.querySelector('#spotifyTargetPlaylistSelect'),
  spotifyNewPlaylistName: document.querySelector('#spotifyNewPlaylistName'),
  spotifySearchField: document.querySelector('.spotify-search-field'),
  spotifyPlaylistSearch: document.querySelector('#spotifyPlaylistSearch'),
  spotifyPlaylistList: document.querySelector('#spotifyPlaylistList'),
  spotifyImportStatus: document.querySelector('#spotifyImportStatus'),
  githubOwnerInput: document.querySelector('#githubOwnerInput'),
  githubRepositoryInput: document.querySelector('#githubRepositoryInput'),
  githubBranchInput: document.querySelector('#githubBranchInput'),
  githubAutoSyncInput: document.querySelector('#githubAutoSyncInput'),
  githubSyncSummary: document.querySelector('#githubSyncSummary'),
  githubAuthStatus: document.querySelector('#githubAuthStatus'),
  chooseGithubAccountButton: document.querySelector('#chooseGithubAccountButton'),
  githubAccountPicker: document.querySelector('#githubAccountPicker'),
  githubAccountMessage: document.querySelector('#githubAccountMessage'),
  githubAccountList: document.querySelector('#githubAccountList'),
  acceptGithubAccountButton: document.querySelector('#acceptGithubAccountButton'),
  githubTestButton: document.querySelector('#githubTestButton'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  githubPullButton: document.querySelector('#githubPullButton'),
  githubPushButton: document.querySelector('#githubPushButton'),
  settingsError: document.querySelector('#settingsError'),
  syncResult: document.querySelector('#syncResult'),
  syncConflictActions: document.querySelector('#syncConflictActions'),
  resolveWithGitHubButton: document.querySelector('#resolveWithGitHubButton'),
  resolveWithLocalButton: document.querySelector('#resolveWithLocalButton'),
  homeStats: document.querySelector('#homeStats'),
  homePlaylistGrid: document.querySelector('#homePlaylistGrid'),
  homeTagCount: document.querySelector('#homeTagCount'),
  tagManager: document.querySelector('#tagManager'),
  playlistEditButton: document.querySelector('#playlistEditButton'),
  playlistSyncButton: document.querySelector('#playlistSyncButton'),
  playlistCount: document.querySelector('#playlistCount'),
  emptyState: document.querySelector('#emptyState'),
  playlistView: document.querySelector('#playlistView'),
  issueBanner: document.querySelector('#issueBanner'),
  playlistName: document.querySelector('#playlistName'),
  playlistFile: document.querySelector('#playlistFileLabel'),
  playlistDescription: document.querySelector('#playlistDescription'),
  playlistMeta: document.querySelector('#playlistMeta'),
  songCount: document.querySelector('#songCount'),
  songList: document.querySelector('#songList'),
  noSongs: document.querySelector('#noSongs'),
  librarySearchForm: document.querySelector('#librarySearchForm'),
  librarySearchInput: document.querySelector('#librarySearchInput'),
  clearLibrarySearch: document.querySelector('#clearLibrarySearch'),
  librarySearchView: document.querySelector('#librarySearchView'),
  librarySearchTitle: document.querySelector('#librarySearchTitle'),
  librarySearchSummary: document.querySelector('#librarySearchSummary'),
  playlistSearchSection: document.querySelector('#playlistSearchSection'),
  playlistMatchCount: document.querySelector('#playlistMatchCount'),
  playlistSearchResults: document.querySelector('#playlistSearchResults'),
  songSearchSection: document.querySelector('#songSearchSection'),
  songMatchCount: document.querySelector('#songMatchCount'),
  songSearchResults: document.querySelector('#songSearchResults'),
  noLibraryMatches: document.querySelector('#noLibraryMatches'),
  quickAddForm: document.querySelector('#quickAddForm'),
  quickAddEditor: document.querySelector('#quickAddEditor'),
  quickAddButton: document.querySelector('#quickAddButton'),
  quickAddError: document.querySelector('#quickAddError'),
  playlistDialog: document.querySelector('#playlistDialog'),
  playlistForm: document.querySelector('#playlistForm'),
  playlistFormError: document.querySelector('#playlistFormError'),
  editPlaylistDialog: document.querySelector('#editPlaylistDialog'),
  editPlaylistForm: document.querySelector('#editPlaylistForm'),
  editPlaylistFormError: document.querySelector('#editPlaylistFormError'),
  toast: document.querySelector('#toast'),
  saveStatus: document.querySelector('#saveStatus'),
  topbarStatus: document.querySelector('.topbar-status'),
  statusDot: document.querySelector('.status-dot'),
};

let library = { playlists: [], issues: [], valid: true };
let selectedId = null;
let libraryQuery = '';
let appNavigationHistory = [];
let appNavigationIndex = -1;
let toastTimer = null;
let songSaveInFlight = false;
let serverReachable = null;
let healthCheckInFlight = false;
let tagRegistry = [];
let editingTagName = null;
let composer = { song: '', artist: '', tags: [], tagDraft: '', showSongToken: false };
let activeComposerProperty = 'song';
let tagRegistrationQueue = Promise.resolve();
let songTagEditor = null;
let draggedPlaylistId = null;
let draggedSong = null;
let currentSection = 'library';
let settingsLoaded = false;
let githubAccounts = [];
let pendingGithubLogin = '';
let selectedGithubLogin = '';
let syncStatus = null;
let lastLibraryFingerprint = null;
let playlistSyncInFlight = false;
let spotifyConnected = false;
let spotifyPlaylists = [];
let spotifyAuthPopup = null;
let spotifyImportInFlight = false;
let exportViewId = null;
const recentImports = new Map();
const youtubeUI = window.createYouTubeUI({
  request: requestJson, getLibrary: () => library, getSelectedId: () => selectedId,
  openSettings: goToSettings,
  onExportView(id) {
    applyNavigation({ selectedId, query: '', section: 'youtube-export', exportId: id }, { historyMode: 'push' });
  },
  onImport(result) {
    library = result.library;
    tagRegistry = result.tags;
    const expires = Date.now() + 2600;
    recentImports.set(result.file, expires);
    render();
    const button = [...elements.tree.querySelectorAll('.tree-button')].find((item) => item.dataset.playlistId === result.file);
    if (button) {
      const bounds = button.getBoundingClientRect();
      const treeBounds = elements.tree.getBoundingClientRect();
      if (bounds.top < treeBounds.top) elements.tree.scrollTop -= treeBounds.top - bounds.top;
      else if (bounds.bottom > treeBounds.bottom) elements.tree.scrollTop += bounds.bottom - treeBounds.bottom;
    }
    setTimeout(() => {
      if (recentImports.get(result.file) !== expires) return;
      recentImports.delete(result.file);
      [...elements.tree.querySelectorAll('.tree-button')].find((item) => item.dataset.playlistId === result.file)?.classList.remove('is-imported');
    }, 2600);
    showToast(`${result.imported} songs imported.`);
  },
});

function byName(name) {
  return library.playlists.find((playlist) => playlist.name?.toLocaleLowerCase('en-US') === name?.toLocaleLowerCase('en-US'));
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 3200);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The local app could not complete that request.');
  if (result.library?.revision) lastLibraryFingerprint = result.library.revision;
  if (result.sync) applySyncStatus(result.sync);
  if (options?.method === 'POST' && (/^\/api\/(songs|playlists)(\/|$)/.test(url)
    || ['/api/settings', '/api/tags/update', '/api/github/account', '/api/spotify/import', '/api/youtube/import'].includes(url))) {
    setTimeout(() => refreshSyncStatus(), 0);
  }
  return result;
}

function setServerStatus(online) {
  serverReachable = online;
  renderStorageStatus();
}

function renderStorageStatus() {
  const online = serverReachable !== false;
  elements.topbarStatus.classList.toggle('is-offline', !online);
  elements.statusDot.classList.toggle('is-offline', !online);
  const pending = syncStatus?.pendingFiles || 0;
  const syncing = syncStatus?.activity === 'syncing' || syncStatus?.scheduled;
  elements.topbarStatus.classList.toggle('is-warning', online && pending > 0);
  elements.topbarStatus.classList.toggle('is-sync-error', online && Boolean(syncStatus?.error));
  elements.topbarStatus.classList.toggle('is-syncing', online && Boolean(syncing));
  elements.saveStatus.textContent = !online ? 'Offline'
    : syncing ? 'Syncing to GitHub…'
      : syncStatus?.error ? 'GitHub sync failed'
        : pending ? `${pending} playlist${pending === 1 ? '' : 's'} not synced`
          : syncStatus?.configured && syncStatus.checkedAt ? 'Synced to GitHub' : 'Saved locally';
  elements.topbarStatus.title = !online ? 'The local server is not responding.'
    : syncStatus?.error || (syncStatus?.checkedAt ? `GitHub checked at ${new Date(syncStatus.checkedAt).toLocaleString()}` : 'Saved on this computer.');
}

function renderPlaylistSyncStatus(playlist) {
  let chip = elements.playlistMeta.querySelector('.playlist-sync-status');
  if (!chip) {
    chip = makeElement('span', 'meta-chip playlist-sync-status');
    elements.playlistMeta.append(chip);
  }
  const file = syncStatus?.files.find((item) => item.file === playlist.id);
  const synced = file?.status === 'synced';
  const changes = file?.changes || 1;
  const at = file?.syncedAt ? new Date(file.syncedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  chip.textContent = synced ? `Synced to GitHub at ${at}`
    : file?.status === 'remote-changed' ? 'GitHub changes not imported'
      : `${changes} change${changes === 1 ? '' : 's'} not synced${['conflict', 'path-conflict'].includes(file?.status) ? ' · conflict' : ''}`;
  chip.classList.toggle('is-pending', !synced);
  chip.title = syncStatus?.error || (file?.status === 'path-conflict' ? 'Local and remote filenames differ only by letter case. Match their spelling before syncing.'
    : synced && file.syncedAt ? new Date(file.syncedAt).toLocaleString() : syncStatus?.autoSync ? 'Waiting for GitHub sync.' : 'Auto-sync is off.');
  elements.playlistSyncButton.hidden = synced;
  elements.playlistSyncButton.disabled = playlistSyncInFlight || syncStatus?.activity === 'syncing';
  elements.playlistSyncButton.textContent = playlistSyncInFlight ? 'Syncing…' : 'Sync';
  elements.playlistSyncButton.title = syncStatus?.configured ? 'Sync this playlist with GitHub' : 'Set up GitHub sync';
}

async function syncCurrentPlaylist() {
  const playlist = library.playlists.find((item) => item.id === selectedId);
  if (!playlist || playlistSyncInFlight) return;
  if (!syncStatus?.configured) {
    await goToSettings();
    showToast('Choose a GitHub repository and account to sync.');
    return;
  }
  const file = syncStatus.files.find((item) => item.file === playlist.id);
  if (['conflict', 'path-conflict'].includes(file?.status)) {
    await goToSettings();
    showToast('Review the sync conflict in Settings.');
    return;
  }
  playlistSyncInFlight = true;
  renderPlaylistSyncStatus(playlist);
  try {
    const result = await requestJson('/api/github/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'both', file: playlist.id }),
    });
    library = result.library;
    tagRegistry = result.tags;
    render();
    if (result.conflicts.length) {
      await goToSettings();
      showToast('Review the sync conflict in Settings.');
    } else showToast(`${playlist.name} synced to GitHub.`);
  } catch (error) { showToast(error.message); }
  finally {
    playlistSyncInFlight = false;
    const current = library.playlists.find((item) => item.id === selectedId);
    if (current) renderPlaylistSyncStatus(current);
    await refreshSyncStatus();
  }
}

function applySyncStatus(status) {
  syncStatus = status;
  renderStorageStatus();
  const playlist = library.playlists.find((item) => item.id === selectedId);
  if (playlist && currentSection === 'library' && !libraryQuery.trim()) renderPlaylistSyncStatus(playlist);
  elements.githubSyncSummary.textContent = status.error || (!status.configured ? 'GitHub backup is not configured.'
    : status.pendingFiles ? `${status.pendingFiles} playlist${status.pendingFiles === 1 ? '' : 's'} not synced${status.autoSync ? '' : ' · Auto-sync off'}`
      : status.checkedAt ? `Synced to ${status.repository}` : 'GitHub has not been checked yet.');
  const conflicts = status.files.filter((item) => item.status === 'conflict').map((item) => item.file);
  const pathConflicts = status.files.filter((item) => item.status === 'path-conflict').map((item) => item.file);
  if (pathConflicts.length) elements.githubSyncSummary.textContent += ` · Match filename casing: ${pathConflicts.join(', ')}`;
  elements.syncConflictActions.dataset.paths = JSON.stringify(conflicts);
  elements.syncConflictActions.hidden = conflicts.length === 0;
}

async function refreshSyncStatus() {
  try { applySyncStatus(await requestJson('/api/github/status')); }
  catch { /* The health check reports local server availability separately. */ }
}

function setFormError(element, message) {
  element.textContent = message;
  element.hidden = !message;
}

function splitTags(value) {
  return value.split(',').map((tag) => tag.trim()).filter(Boolean);
}

const COMPOSER_PROPERTY_ORDER = ['song', 'artist', 'tags'];

function tagRecord(name) {
  return tagRegistry.find((entry) => entry.name.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'));
}

function tagTextColor(hex) {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return (red * 299 + green * 587 + blue * 114) / 1000 > 155 ? '#26332a' : '#ffffff';
}

function applyTagColor(element, name) {
  const entry = tagRecord(name);
  if (!entry) return;
  element.style.backgroundColor = entry.color;
  element.style.color = tagTextColor(entry.color);
  element.style.borderColor = entry.color;
}

function applyKnownTagColors(root = document) {
  root.querySelectorAll('[data-tag-name]').forEach((element) => applyTagColor(element, element.dataset.tagName));
}

function registerTagNames(names) {
  const distinct = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  if (!distinct.length) return tagRegistrationQueue;
  tagRegistrationQueue = tagRegistrationQueue.then(async () => {
    const result = await requestJson('/api/tags/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: distinct }),
    });
    tagRegistry = result.tags;
    applyKnownTagColors();
    renderHome();
  }).catch((error) => showToast(error.message));
  return tagRegistrationQueue;
}

function composerHasValue(property) {
  if (property === 'tags') return composer.tags.length > 0;
  return Boolean(composer[property].trim());
}

function propertyLabel(property) {
  return { song: 'SONG:', artist: 'ARTIST:', tags: 'TAGS:' }[property];
}

function focusComposerProperty(property = activeComposerProperty, caret) {
  const input = elements.quickAddEditor.querySelector(`[data-property="${property}"]`);
  if (!input) return;
  input.focus();
  if (Number.isInteger(caret) && property !== 'tags') input.setSelectionRange(caret, caret);
}

function cycleComposerProperty(direction) {
  if (activeComposerProperty === 'tags') {
    addComposerTag(composer.tagDraft);
    composer.tagDraft = '';
  }
  const currentIndex = COMPOSER_PROPERTY_ORDER.indexOf(activeComposerProperty);
  activeComposerProperty = COMPOSER_PROPERTY_ORDER[(currentIndex + direction + COMPOSER_PROPERTY_ORDER.length) % COMPOSER_PROPERTY_ORDER.length];
  renderQuickAddEditor({ focus: true });
}

function renderTagSuggestions(panel, input, usedTags, onSelect) {
  const query = input.value.trim().toLocaleLowerCase('en-US');
  const used = new Set(usedTags().map((tag) => tag.toLocaleLowerCase('en-US')));
  const matches = tagRegistry
    .filter((entry) => !used.has(entry.name.toLocaleLowerCase('en-US')))
    .filter((entry) => !query || entry.name.toLocaleLowerCase('en-US').includes(query))
    .slice(0, 7);
  panel.replaceChildren();
  for (const entry of matches) {
    const option = makeElement('button', 'tag-suggestion', entry.name);
    option.type = 'button';
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => onSelect(entry.name));
    option.addEventListener('keydown', (event) => {
      const options = [...panel.querySelectorAll('button')];
      const index = options.indexOf(option);
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        options[(index + 1) % options.length]?.focus();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (index === 0) input.focus();
        else options[index - 1]?.focus();
      } else if (event.key === 'Escape') {
        panel.hidden = true;
        input.focus();
      } else if (event.key === 'Tab' && input.dataset.property) {
        event.preventDefault();
        cycleComposerProperty(event.shiftKey ? -1 : 1);
      }
    });
    applyTagColor(option, entry.name);
    panel.append(option);
  }
  panel.hidden = matches.length === 0;
}

function addComposerTag(value) {
  const tag = value.trim();
  if (!tag || composer.tags.some((existing) => existing.toLocaleLowerCase('en-US') === tag.toLocaleLowerCase('en-US'))) return;
  composer.tags.push(tag);
  registerTagNames([tag]);
}

function commitComposerTag() {
  addComposerTag(composer.tagDraft);
  composer.tagDraft = '';
  if (activeComposerProperty === 'tags') renderQuickAddEditor({ focus: true });
}

function makeTagChip(name, index, { removable = false, onRemove = null } = {}) {
  const chip = makeElement('span', removable ? 'composer-tag-chip' : 'meta-chip tag-chip', removable ? name : `#${name}`);
  chip.dataset.tagName = name;
  applyTagColor(chip, name);
  if (removable) {
    const remove = makeElement('button', 'tag-chip-remove', '×');
    remove.type = 'button';
    remove.tabIndex = -1;
    remove.setAttribute('aria-label', `Remove tag ${name}`);
    remove.addEventListener('click', onRemove);
    chip.append(remove);
  }
  return chip;
}

function renderComposerProperty(property, editable) {
  const token = makeElement(editable ? 'div' : 'button', `composer-token ${property}-property${editable ? ' is-active' : ' is-filled'}`);
  if (!editable) {
    token.type = 'button';
    token.addEventListener('click', () => {
      activeComposerProperty = property;
      composer.showSongToken ||= property === 'song';
      renderQuickAddEditor({ focus: true });
    });
  }
  token.append(makeElement('span', 'composer-token-label', propertyLabel(property)));

  if (property === 'tags') {
    composer.tags.forEach((name, index) => token.append(makeTagChip(name, index, {
      removable: editable,
      onRemove: () => {
        composer.tags.splice(index, 1);
        renderQuickAddEditor({ focus: editable });
      },
    })));
    if (editable) {
      const input = makeElement('input', 'composer-token-input');
      input.type = 'text';
      input.placeholder = composer.tags.length ? 'another tag' : 'add a tag';
      input.setAttribute('aria-label', 'Tag; type a comma to finish it');
      input.dataset.property = property;
      input.value = composer.tagDraft;
      const suggestions = makeElement('div', 'tag-suggestions');
      suggestions.hidden = true;
      input.addEventListener('input', () => {
        const parts = input.value.split(',');
        if (parts.length > 1) {
          parts.slice(0, -1).forEach(addComposerTag);
          composer.tagDraft = parts.at(-1);
          renderQuickAddEditor({ focus: true });
          return;
        }
        composer.tagDraft = input.value;
        renderTagSuggestions(suggestions, input, () => composer.tags, (name) => {
          addComposerTag(name);
          composer.tagDraft = '';
          renderQuickAddEditor({ focus: true });
        });
      });
      input.addEventListener('focus', () => renderTagSuggestions(suggestions, input, () => composer.tags, (name) => {
        addComposerTag(name);
        composer.tagDraft = '';
        renderQuickAddEditor({ focus: true });
      }));
      input.addEventListener('keydown', (event) => {
        if (event.key === ',') {
          event.preventDefault();
          commitComposerTag();
        } else if (event.key === 'Backspace' && !input.value && composer.tags.length) {
          composer.tags.pop();
          renderQuickAddEditor({ focus: true });
          event.preventDefault();
        } else if (event.key === 'ArrowDown' && !suggestions.hidden) {
          event.preventDefault();
          suggestions.querySelector('button')?.focus();
        }
      });
      token.append(input, suggestions);
    }
    return token;
  }

  if (editable) {
    const input = makeElement('input', 'composer-token-input');
    input.type = 'text';
    input.placeholder = property === 'song' ? 'type a song' : 'add artist';
    input.setAttribute('aria-label', property === 'song' ? 'Song' : 'Artist');
    input.dataset.property = property;
    input.value = composer[property];
    input.addEventListener('input', () => {
      composer[property] = input.value;
      if (property === 'song' && !composer.showSongToken && input.value) {
        composer.showSongToken = true;
        renderQuickAddEditor({ focus: true, caret: input.selectionStart || input.value.length });
      }
    });
    token.append(input);
  } else {
    token.append(makeElement('span', 'composer-token-value', composer[property]));
  }
  return token;
}

function renderQuickAddEditor({ focus = false, caret } = {}) {
  elements.quickAddEditor.replaceChildren();
  const bareSong = activeComposerProperty === 'song'
    && !composer.showSongToken
    && !composer.song
    && !composer.artist
    && composer.tags.length === 0;
  elements.quickAddEditor.classList.toggle('is-bare', bareSong);
  if (bareSong) {
    const input = makeElement('input', 'composer-bare-input');
    input.type = 'text';
    input.placeholder = 'Add a song';
    input.setAttribute('aria-label', 'Song');
    input.dataset.property = 'song';
    input.addEventListener('input', () => {
      composer.song = input.value;
      if (input.value) {
        composer.showSongToken = true;
        renderQuickAddEditor({ focus: true, caret: input.selectionStart || input.value.length });
      }
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        cycleComposerProperty(event.shiftKey ? -1 : 1);
      }
    });
    elements.quickAddEditor.append(input);
    if (focus) input.focus();
    return;
  }

  for (const property of COMPOSER_PROPERTY_ORDER) {
    const editable = property === activeComposerProperty;
    if (!editable && !composerHasValue(property)) continue;
    const token = renderComposerProperty(property, editable);
    if (editable && property !== 'tags') {
      token.querySelector('input').addEventListener('keydown', (event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          cycleComposerProperty(event.shiftKey ? -1 : 1);
        }
      });
    } else if (editable && property === 'tags') {
      token.querySelector('input').addEventListener('keydown', (event) => {
        if (event.key === 'Tab') {
          event.preventDefault();
          cycleComposerProperty(event.shiftKey ? -1 : 1);
        }
      });
    }
    elements.quickAddEditor.append(token);
  }
  if (focus) focusComposerProperty(activeComposerProperty, caret);
}

function currentNavigationView() {
  return { selectedId, query: libraryQuery, section: currentSection, exportId: exportViewId };
}

function recordNavigation(view, mode = 'push') {
  const state = { playlistaNavigation: true, index: appNavigationIndex, view };
  if (mode === 'replace') {
    appNavigationHistory[appNavigationIndex] = view;
    window.history.replaceState(state, '', window.location.href);
    return;
  }
  const current = appNavigationHistory[appNavigationIndex];
  if (current && current.selectedId === view.selectedId && current.query === view.query && current.section === view.section && current.exportId === view.exportId) {
    return;
  }
  appNavigationHistory = appNavigationHistory.slice(0, appNavigationIndex + 1);
  appNavigationHistory.push(view);
  appNavigationIndex = appNavigationHistory.length - 1;
  state.index = appNavigationIndex;
  window.history.pushState(state, '', window.location.href);
}

function applyNavigation(view, { historyMode = null, resetComposerOnNavigate = false } = {}) {
  const previousId = selectedId;
  currentSection = ['settings', 'youtube-export'].includes(view.section) ? view.section : 'library';
  exportViewId = view.exportId || null;
  selectedId = library.playlists.some((playlist) => playlist.id === view.selectedId) ? view.selectedId : null;
  libraryQuery = view.query || '';
  elements.librarySearchInput.value = libraryQuery;
  elements.clearLibrarySearch.hidden = !libraryQuery;
  if (previousId !== selectedId || resetComposerOnNavigate) resetComposer();
  if (historyMode) recordNavigation(currentNavigationView(), historyMode);
  render();
}

function initializeNavigationHistory() {
  appNavigationHistory = [currentNavigationView()];
  appNavigationIndex = 0;
  window.history.replaceState({ playlistaNavigation: true, index: 0, view: appNavigationHistory[0] }, '', window.location.href);
}

function resetComposer() {
  elements.quickAddButton.disabled = false;
  elements.quickAddButton.classList.remove('is-saving');
  composer = { song: '', artist: '', tags: [], tagDraft: '', showSongToken: false };
  activeComposerProperty = 'song';
  songTagEditor = null;
  renderQuickAddEditor();
  setFormError(elements.quickAddError, '');
}

function goToPlaylist(id) {
  applyNavigation({ selectedId: id, query: '', section: 'library' }, { historyMode: 'push', resetComposerOnNavigate: true });
}

function goHome() {
  applyNavigation({ selectedId: null, query: '', section: 'library' }, { historyMode: 'push', resetComposerOnNavigate: true });
}

async function goToSettings() {
  applyNavigation({ selectedId: null, query: '', section: 'settings' }, { historyMode: 'push', resetComposerOnNavigate: true });
  if (settingsLoaded) {
    await Promise.all([refreshSpotifyStatus(), youtubeUI.refresh()]);
    return;
  }
  try {
    const result = await requestJson('/api/settings');
    fillSettings(result);
    await Promise.all([refreshSpotifyStatus(), youtubeUI.refresh()]);
  } catch (error) {
    setFormError(elements.settingsError, error.message);
  }
}

function fillSettings(settings) {
  elements.playlistDirectoryInput.value = settings.playlistDirectory || '';
  elements.githubOwnerInput.value = settings.github?.owner || '';
  elements.githubRepositoryInput.value = settings.github?.repository || '';
  elements.githubBranchInput.value = settings.github?.branch || 'main';
  elements.githubAutoSyncInput.checked = settings.github?.autoSync === true;
  elements.spotifyClientIdInput.value = settings.spotify?.clientId || '';
  elements.spotifyRedirectUri.textContent = settings.spotify?.redirectUri || `http://127.0.0.1:${window.location.port || '43817'}/spotify/callback`;
  selectedGithubLogin = settings.github?.login || '';
  elements.githubAuthStatus.textContent = selectedGithubLogin ? `Using ${selectedGithubLogin}` : 'No account selected';
  settingsLoaded = true;
}

function settingsPayload() {
  return {
    playlistDirectory: elements.playlistDirectoryInput.value.trim(),
    github: {
      owner: elements.githubOwnerInput.value.trim(),
      repository: elements.githubRepositoryInput.value.trim(),
      branch: elements.githubBranchInput.value.trim(),
      autoSync: elements.githubAutoSyncInput.checked,
    },
    spotify: { clientId: elements.spotifyClientIdInput.value.trim() },
  };
}

async function refreshSpotifyStatus() {
  try {
    const result = await requestJson('/api/spotify/status');
    spotifyConnected = result.connected;
    elements.spotifyAuthStatus.textContent = spotifyConnected ? 'Connected for this app session' : 'Not connected';
    elements.spotifyConnectButton.hidden = spotifyConnected;
    elements.spotifyDisconnectButton.hidden = !spotifyConnected;
    elements.spotifyLoadPlaylistsButton.disabled = !spotifyConnected;
  } catch (error) {
    elements.spotifyAuthStatus.textContent = 'Spotify status unavailable';
  }
}

async function connectSpotify() {
  setFormError(elements.settingsError, '');
  const popup = window.open('about:blank', 'playlista-spotify-auth', 'popup,width=540,height=720');
  if (!popup) {
    setFormError(elements.settingsError, 'Allow pop-ups for Playlista to sign in to Spotify.');
    return;
  }
  spotifyAuthPopup = popup;
  elements.spotifyConnectButton.disabled = true;
  try {
    await saveSettings();
    const result = await requestJson('/api/spotify/connect', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: elements.spotifyClientIdInput.value.trim() }),
    });
    popup.location = result.authorizationUrl;
    elements.spotifyAuthStatus.textContent = 'Waiting for Spotify authorization…';
  } catch (error) {
    popup.close();
    spotifyAuthPopup = null;
    setFormError(elements.settingsError, error.message);
  } finally {
    elements.spotifyConnectButton.disabled = false;
  }
}

async function disconnectSpotify() {
  try {
    await requestJson('/api/spotify/disconnect', { method: 'POST' });
    spotifyConnected = false;
    spotifyPlaylists = [];
    elements.spotifyPlaylistList.replaceChildren();
    elements.spotifyImportStatus.hidden = true;
    elements.spotifyAuthStatus.textContent = 'Not connected';
    elements.spotifyConnectButton.hidden = false;
    elements.spotifyDisconnectButton.hidden = true;
    elements.spotifyLoadPlaylistsButton.disabled = true;
    elements.spotifySearchField.hidden = true;
  } catch (error) {
    setFormError(elements.settingsError, error.message);
  }
}

function updateSpotifyDestinationChoices() {
  const select = elements.spotifyTargetPlaylistSelect;
  if (!select) return;
  const previous = select.value;
  select.replaceChildren(new Option('New playlist with Spotify’s name', ''));
  for (const playlist of library.playlists) select.add(new Option(`Append to ${playlist.name}`, playlist.id));
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function renderSpotifyPlaylists() {
  const panel = elements.spotifyPlaylistList;
  if (!panel) return;
  updateSpotifyDestinationChoices();
  panel.replaceChildren();
  const query = elements.spotifyPlaylistSearch.value.trim().toLocaleLowerCase('en-US');
  const matches = spotifyPlaylists.filter((playlist) => !query || playlist.name.toLocaleLowerCase('en-US').includes(query));
  elements.spotifySearchField.hidden = spotifyPlaylists.length === 0;
  if (!spotifyPlaylists.length) return;
  if (!matches.length) {
    panel.append(makeElement('p', 'spotify-empty-result', 'No Spotify playlists match this search.'));
    return;
  }
  for (const playlist of matches) {
    const row = makeElement('div', 'spotify-playlist-row');
    const details = makeElement('div', 'spotify-playlist-details');
    details.append(makeElement('strong', 'spotify-playlist-name', playlist.name));
    const count = `${playlist.total} song${playlist.total === 1 ? '' : 's'}`;
    details.append(makeElement('span', 'spotify-playlist-count', playlist.importable ? count : `${count} · items unavailable`));
    row.append(details);
    const button = makeElement('button', 'button button-small button-soft', playlist.importable ? 'Import' : 'Unavailable');
    button.type = 'button';
    button.disabled = !playlist.importable || spotifyImportInFlight;
    button.addEventListener('click', () => importSpotifyPlaylist(playlist, button));
    row.append(button);
    panel.append(row);
  }
}

async function loadSpotifyPlaylists() {
  elements.spotifyLoadPlaylistsButton.disabled = true;
  elements.spotifyAuthStatus.textContent = 'Loading Spotify playlists…';
  setFormError(elements.settingsError, '');
  try {
    const result = await requestJson('/api/spotify/playlists');
    spotifyPlaylists = result.playlists;
    elements.spotifyAuthStatus.textContent = `${spotifyPlaylists.length} Spotify playlists loaded`;
    renderSpotifyPlaylists();
    elements.spotifyImportStatus.hidden = spotifyPlaylists.length > 0;
    if (!spotifyPlaylists.length) {
      elements.spotifyImportStatus.textContent = 'No playlists were found on this Spotify account.';
    }
  } catch (error) {
    elements.spotifyAuthStatus.textContent = 'Could not load Spotify playlists';
    setFormError(elements.settingsError, error.message);
  } finally {
    elements.spotifyLoadPlaylistsButton.disabled = !spotifyConnected;
  }
}

async function importSpotifyPlaylist(playlist, button) {
  if (spotifyImportInFlight) return;
  spotifyImportInFlight = true;
  button.disabled = true;
  button.textContent = 'Importing…';
  elements.spotifyImportStatus.hidden = false;
  elements.spotifyImportStatus.textContent = `Reading “${playlist.name}” from Spotify…`;
  try {
    const file = elements.spotifyTargetPlaylistSelect.value;
    const result = await requestJson('/api/spotify/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: playlist.id,
        name: elements.spotifyNewPlaylistName.value.trim() || playlist.name,
        description: playlist.description,
        file,
      }),
    });
    library = result.library;
    tagRegistry = result.tags;
    selectedId = result.file;
    applyNavigation({ selectedId, query: '', section: 'library' }, { historyMode: 'push', resetComposerOnNavigate: true });
    render();
    elements.spotifyImportStatus.hidden = false;
    elements.spotifyImportStatus.textContent = `${result.imported} songs imported${result.skipped ? ` · ${result.skipped} unavailable tracks or non-song items skipped` : ''}.`;
    showToast(`${result.imported} songs imported to ${library.playlists.find((item) => item.id === result.file)?.name || 'playlist'}.`);
    renderSpotifyPlaylists();
  } catch (error) {
    elements.spotifyImportStatus.hidden = false;
    elements.spotifyImportStatus.textContent = error.message;
  } finally {
    spotifyImportInFlight = false;
    renderSpotifyPlaylists();
  }
}

async function saveSettings(event) {
  event?.preventDefault();
  setFormError(elements.settingsError, '');
  elements.syncResult.hidden = true;
  elements.saveSettingsButton.disabled = true;
  try {
    const result = await requestJson('/api/settings', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settingsPayload()),
    });
    fillSettings(result.settings);
    library = result.library;
    render();
    showToast('Settings saved.');
  } catch (error) {
    setFormError(elements.settingsError, error.message);
    throw error;
  } finally {
    elements.saveSettingsButton.disabled = false;
  }
}

async function testGitHubConnection() {
  setFormError(elements.settingsError, '');
  elements.githubTestButton.disabled = true;
  try {
    await saveSettings();
    elements.githubAuthStatus.textContent = 'Checking repository access…';
    const result = await requestJson('/api/github/test', { method: 'POST' });
    elements.githubAuthStatus.textContent = result.emptyRepository
      ? `Connected as ${result.account} · ${result.repository} · Empty repository; Save to GitHub will initialize it`
      : `Connected as ${result.account} · ${result.repository} · ${result.playlistFiles} playlist files`;
  } catch (error) {
    elements.githubAuthStatus.textContent = 'Not connected';
    setFormError(elements.settingsError, error.message);
  } finally {
    elements.githubTestButton.disabled = false;
  }
}

function renderGithubAccounts() {
  elements.githubAccountList.replaceChildren();
  for (const account of githubAccounts) {
    const option = makeElement('button', `github-account-option${pendingGithubLogin === account.login ? ' is-selected' : ''}`);
    option.type = 'button';
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(pendingGithubLogin === account.login));
    option.addEventListener('click', () => {
      pendingGithubLogin = account.login;
      renderGithubAccounts();
    });
    option.append(makeElement('strong', 'github-account-name', account.login));
    const badges = makeElement('span', 'github-account-badges');
    if (account.active) badges.append(makeElement('span', 'github-account-badge', 'CLI active'));
    if (selectedGithubLogin.toLocaleLowerCase('en-US') === account.login.toLocaleLowerCase('en-US')) badges.append(makeElement('span', 'github-account-badge is-current', 'Used by Playlista'));
    option.append(badges);
    elements.githubAccountList.append(option);
  }
  elements.acceptGithubAccountButton.disabled = !pendingGithubLogin;
  elements.acceptGithubAccountButton.textContent = pendingGithubLogin ? `Use ${pendingGithubLogin}` : 'Use selected account';
}

async function openGithubAccountPicker() {
  elements.githubAccountPicker.hidden = false;
  elements.githubAccountMessage.textContent = 'Loading GitHub CLI accounts…';
  elements.githubAccountList.replaceChildren();
  elements.chooseGithubAccountButton.disabled = true;
  try {
    const result = await requestJson('/api/github/accounts');
    githubAccounts = result.accounts;
    selectedGithubLogin = result.selected || '';
    pendingGithubLogin = result.selected || githubAccounts.find((account) => account.active)?.login || '';
    if (!githubAccounts.length) {
      elements.githubAccountMessage.textContent = 'No authenticated GitHub accounts found. Run gh auth login in a terminal, then load accounts again.';
      renderGithubAccounts();
      return;
    }
    elements.githubAccountMessage.textContent = 'Select an account. The CLI active account is marked; Playlista will use your choice without switching it.';
    renderGithubAccounts();
  } catch (error) {
    elements.githubAccountMessage.textContent = error.message;
    pendingGithubLogin = '';
    renderGithubAccounts();
  } finally {
    elements.chooseGithubAccountButton.disabled = false;
  }
}

async function acceptGithubAccount() {
  if (!pendingGithubLogin) return;
  elements.acceptGithubAccountButton.disabled = true;
  try {
    const result = await requestJson('/api/github/account', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: pendingGithubLogin }),
    });
    selectedGithubLogin = result.login;
    elements.githubAuthStatus.textContent = `Using ${result.login}`;
    elements.githubAccountPicker.hidden = true;
    renderGithubAccounts();
    showToast(`GitHub account ${result.login} selected for Playlista.`);
  } catch (error) {
    elements.githubAccountMessage.textContent = error.message;
    elements.acceptGithubAccountButton.disabled = false;
  }
}

async function syncGitHub(direction) {
  setFormError(elements.settingsError, '');
  elements.syncResult.hidden = true;
  elements.syncConflictActions.hidden = true;
  const button = direction === 'pull' ? elements.githubPullButton : elements.githubPushButton;
  button.disabled = true;
  button.textContent = direction === 'pull' ? 'Importing…' : 'Saving…';
  try {
    await saveSettings();
    const result = await requestJson('/api/github/sync', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ direction }),
    });
    library = result.library;
    tagRegistry = result.tags;
    render();
    const lines = [`${result.added} added`, `${result.updated} updated`, `${result.unchanged} unchanged`];
    if (result.conflicts.length) lines.push(`Conflicts: ${result.conflicts.join(', ')}`);
    if (result.notices.length) lines.push(...result.notices);
    elements.syncResult.textContent = lines.join(' · ');
    elements.syncResult.hidden = false;
    elements.githubAuthStatus.textContent = `Connected as ${selectedGithubLogin} · ${elements.githubOwnerInput.value}/${elements.githubRepositoryInput.value}`;
  } catch (error) {
    setFormError(elements.settingsError, error.message);
  } finally {
    button.disabled = false;
    button.textContent = direction === 'pull' ? 'Import from GitHub' : 'Save to GitHub';
  }
}

async function resolveGitHubConflicts(direction) {
  const paths = JSON.parse(elements.syncConflictActions.dataset.paths || '[]');
  if (!paths.length) return;
  const label = direction === 'pull' ? 'GitHub' : 'local';
  if (!window.confirm(`Replace the other copy of ${paths.join(', ')} with the ${label} version?`)) return;
  const button = direction === 'pull' ? elements.resolveWithGitHubButton : elements.resolveWithLocalButton;
  button.disabled = true;
  try {
    const result = await requestJson('/api/github/resolve', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction, paths }),
    });
    library = result.library;
    tagRegistry = result.tags;
    render();
    elements.syncResult.textContent = `${result.resolved.length} conflict${result.resolved.length === 1 ? '' : 's'} resolved using ${label} versions.`;
    elements.syncConflictActions.hidden = true;
    elements.syncConflictActions.dataset.paths = '[]';
    elements.syncResult.hidden = false;
  } catch (error) {
    setFormError(elements.settingsError, error.message);
  } finally {
    elements.resolveWithGitHubButton.disabled = false;
    elements.resolveWithLocalButton.disabled = false;
  }
}

async function refreshLibrary(preferredId = null) {
  elements.saveStatus.textContent = 'Loading...';
  try {
    const [nextLibrary, tagData] = await Promise.all([requestJson('/api/library'), requestJson('/api/tags')]);
    library = nextLibrary;
    lastLibraryFingerprint = nextLibrary.revision || nextLibrary.sync?.localFingerprint || null;
    tagRegistry = tagData.tags;
    selectedId = library.playlists.some((playlist) => playlist.id === preferredId)
      ? preferredId
      : null;
    setServerStatus(true);
    render();
  } catch (error) {
    setServerStatus(false);
    elements.issueBanner.hidden = false;
    elements.issueBanner.textContent = error.message;
  }
}

async function checkServerHealth() {
  if (healthCheckInFlight) return;
  healthCheckInFlight = true;
  try {
    const result = await requestJson('/api/health');
    const wasOffline = serverReachable === false;
    setServerStatus(true);
    if (wasOffline || (lastLibraryFingerprint && result.sync?.localFingerprint !== lastLibraryFingerprint)) await refreshLibrary(selectedId);
  } catch {
    setServerStatus(false);
  } finally {
    healthCheckInFlight = false;
  }
}

function renderTree() {
  const scrollTop = elements.tree.scrollTop;
  elements.tree.replaceChildren();
  const playlists = [...library.playlists].sort((left, right) => (left.name || '').localeCompare(right.name || ''));
  elements.playlistCount.textContent = String(playlists.length);
  if (!playlists.length) {
    elements.tree.append(makeElement('p', 'tree-empty', 'Your playlist list will appear here.'));
    return;
  }

  const children = new Map(playlists.map((playlist) => [playlist.id, []]));
  const roots = [];
  for (const playlist of playlists) {
    const parent = playlist.parent ? byName(playlist.parent) : null;
    if (parent && parent.id !== playlist.id) children.get(parent.id).push(playlist);
    else roots.push(playlist);
  }
  for (const nested of children.values()) nested.sort((left, right) => (left.name || '').localeCompare(right.name || ''));
  const visited = new Set();
  const list = document.createElement('ul');
  const appendNode = (playlist, parentList) => {
    if (visited.has(playlist.id)) return;
    visited.add(playlist.id);
    const item = makeElement('li', 'tree-item');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-button';
    button.dataset.playlistId = playlist.id;
    if ((recentImports.get(playlist.id) || 0) > Date.now()) button.classList.add('is-imported');
    if (playlist.id === selectedId) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => goToPlaylist(playlist.id));
    button.draggable = true;
    button.addEventListener('dragstart', (event) => {
      draggedPlaylistId = playlist.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', playlist.id);
      button.classList.add('is-dragging');
    });
    button.addEventListener('dragend', () => {
      draggedPlaylistId = null;
      elements.tree.querySelectorAll('.drop-target, .is-dragging').forEach((node) => node.classList.remove('drop-target', 'is-dragging'));
      elements.homeButton.classList.remove('drop-target');
    });
    button.addEventListener('dragover', (event) => {
      if (!draggedPlaylistId || draggedPlaylistId === playlist.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      button.classList.add('drop-target');
    });
    button.addEventListener('dragleave', () => button.classList.remove('drop-target'));
    button.addEventListener('drop', (event) => {
      event.preventDefault();
      button.classList.remove('drop-target');
      if (draggedPlaylistId && draggedPlaylistId !== playlist.id) changePlaylistParent(draggedPlaylistId, playlist.name);
    });
    button.append(makeElement('span', 'tree-glyph', '♫'), makeElement('span', 'tree-name', playlist.name || 'Unnamed playlist'));
    if (!playlist.valid) {
      button.title = 'This playlist has validation issues.';
      button.append(makeElement('span', 'tree-invalid'));
    }
    item.append(button);
    const nested = children.get(playlist.id) || [];
    if (nested.length) {
      const sublist = document.createElement('ul');
      for (const child of nested) appendNode(child, sublist);
      item.append(sublist);
    }
    parentList.append(item);
  };

  for (const root of roots) appendNode(root, list);
  for (const playlist of playlists) appendNode(playlist, list);
  elements.tree.append(list);
  elements.tree.scrollTop = scrollTop;
}

function renderIssues() {
  elements.issueBanner.replaceChildren();
  if (!library.issues.length) {
    elements.issueBanner.hidden = true;
    return;
  }
  elements.issueBanner.hidden = false;
  const heading = makeElement('strong', '', `${library.issues.length} playlist validation issue${library.issues.length === 1 ? '' : 's'}`);
  const list = document.createElement('ul');
  for (const issue of library.issues.slice(0, 8)) {
    const item = document.createElement('li');
    const location = `${issue.source || 'playlist'}${issue.line ? `:${issue.line}` : ''}`;
    item.append(makeElement('span', 'issue-location', `${location} - `), document.createTextNode(issue.message));
    list.append(item);
  }
  if (library.issues.length > 8) list.append(makeElement('li', '', `and ${library.issues.length - 8} more`));
  elements.issueBanner.append(heading, list);
}

function renderMetadata(playlist) {
  elements.playlistMeta.replaceChildren();
  if (playlist.parent) {
    const parent = byName(playlist.parent);
    const chip = document.createElement(parent ? 'button' : 'span');
    chip.className = parent ? 'meta-chip button-chip' : 'meta-chip';
    chip.textContent = parent ? `Parent: ${parent.name}` : `Missing parent: ${playlist.parent}`;
    if (parent) {
      chip.type = 'button';
      chip.addEventListener('click', () => goToPlaylist(parent.id));
    }
    elements.playlistMeta.append(chip);
  }
  for (const tag of playlist.tags || []) elements.playlistMeta.append(makeMetadataTag(tag));
  for (const [label, value] of [['Created', playlist.created], ['Updated', playlist.updated]]) {
    if (!value) continue;
    const formatted = compactDate(value);
    const chip = makeElement('span', 'meta-chip date-chip', `${label} ${formatted.label}`);
    chip.title = formatted.full;
    elements.playlistMeta.append(chip);
  }
  renderPlaylistSyncStatus(playlist);
}

function makeMetadataTag(tag) {
  const chip = makeElement('span', 'meta-chip tag-chip', `#${tag}`);
  chip.dataset.tagName = tag;
  applyTagColor(chip, tag);
  return chip;
}

function compactDate(value) {
  return PlaylistUI.formatPlaylistDate(value);
}

function searchForTag(name) {
  const key = name.toLocaleLowerCase('en-US');
  const matchingPlaylists = library.playlists.filter((playlist) =>
    (playlist.tags || []).some((tag) => tag.toLocaleLowerCase('en-US') === key)
    || (playlist.songs || []).some((song) => (song.tags || []).some((tag) => tag.toLocaleLowerCase('en-US') === key)));
  if (matchingPlaylists.length === 1) {
    goToPlaylist(matchingPlaylists[0].id);
    return;
  }
  const phrase = name.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const previousQuery = libraryQuery;
  const query = `tag:"${phrase}"`;
  applyNavigation({ selectedId, query }, { historyMode: previousQuery ? 'replace' : 'push' });
}

async function saveTagEdit(entry, nameInput, colorInput, saveButton) {
  saveButton.disabled = true;
  try {
    const result = await requestJson('/api/tags/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ oldName: entry.name, name: nameInput.value.trim(), color: colorInput.value }),
    });
    library = result.library;
    tagRegistry = result.tags;
    editingTagName = null;
    render();
    showToast('Tag updated.');
  } catch (error) {
    showToast(error.message);
    saveButton.disabled = false;
  }
}

function renderHome() {
  if (!elements.homeView) return;
  const ownSongCount = library.playlists.reduce((count, playlist) => count + (playlist.songs || []).length, 0);
  elements.homeStats.replaceChildren();
  for (const [label, value] of [
    ['Playlists', library.playlists.length],
    ['Song searches', ownSongCount],
    ['Tags', tagRegistry.length],
  ]) {
    const card = makeElement('div', 'overview-stat');
    card.append(makeElement('strong', 'overview-stat-value', String(value)), makeElement('span', 'overview-stat-label', label));
    elements.homeStats.append(card);
  }

  elements.homePlaylistGrid.replaceChildren();
  const sorted = [...library.playlists].sort((left, right) => (left.name || '').localeCompare(right.name || ''));
  for (const playlist of sorted) {
    const card = makeElement('button', 'home-playlist-card');
    card.type = 'button';
    card.addEventListener('click', () => goToPlaylist(playlist.id));
    const heading = makeElement('div', 'home-playlist-card-heading');
    heading.append(makeElement('strong', 'home-playlist-name', playlist.name || 'Unnamed playlist'));
    heading.append(makeElement('span', 'home-playlist-count', `${(playlist.songs || []).length} songs`));
    card.append(heading);
    if (playlist.description) card.append(makeElement('span', 'home-playlist-description', playlist.description));
    if (playlist.parent) card.append(makeElement('span', 'home-playlist-parent', `Parent: ${playlist.parent}`));
    if (playlist.tags?.length) {
      const tags = makeElement('span', 'home-playlist-tags');
      playlist.tags.forEach((tag) => tags.append(makeMetadataTag(tag)));
      card.append(tags);
    }
    const dates = makeElement('span', 'home-playlist-dates');
    if (playlist.created) {
      const date = compactDate(playlist.created);
      const created = makeElement('span', '', `Created ${date.label}`);
      created.title = date.full;
      dates.append(created);
    }
    if (playlist.updated) {
      const date = compactDate(playlist.updated);
      const updated = makeElement('span', '', `Updated ${date.label}`);
      updated.title = date.full;
      dates.append(updated);
    }
    card.append(dates);
    elements.homePlaylistGrid.append(card);
  }

  const tagUsage = new Map(tagRegistry.map((entry) => [entry.name.toLocaleLowerCase('en-US'), { playlists: 0, songs: 0 }]));
  for (const playlist of library.playlists) {
    for (const tag of new Set(playlist.tags || [])) {
      const count = tagUsage.get(tag.toLocaleLowerCase('en-US'));
      if (count) count.playlists += 1;
    }
    for (const song of playlist.songs || []) {
      for (const tag of song.tags || []) {
        const count = tagUsage.get(tag.toLocaleLowerCase('en-US'));
        if (count) count.songs += 1;
      }
    }
  }
  elements.homeTagCount.textContent = String(tagRegistry.length);
  elements.tagManager.replaceChildren();
  if (!tagRegistry.length) {
    elements.tagManager.append(makeElement('p', 'tag-manager-empty', 'Tags appear here when you add them to playlists or songs.'));
    return;
  }
  for (const entry of tagRegistry) {
    const wrapper = makeElement('div', 'tag-pill-wrap');
    const pill = makeElement('div', 'tag-pill');
    applyTagColor(pill, entry.name);
    const search = makeElement('button', 'tag-pill-search', `#${entry.name}`);
    search.type = 'button';
    search.setAttribute('aria-label', `Find playlists and songs tagged ${entry.name}`);
    search.addEventListener('click', () => searchForTag(entry.name));
    const counts = tagUsage.get(entry.name.toLocaleLowerCase('en-US')) || { playlists: 0, songs: 0 };
    const usage = makeElement('span', 'tag-pill-usage', `${counts.songs} songs`);
    usage.title = `${counts.songs} songs across ${counts.playlists} playlists`;
    usage.setAttribute('aria-label', `${counts.songs} songs`);
    pill.append(search, usage);
    const edit = makeElement('button', 'tag-pill-edit', '✎');
    edit.type = 'button';
    edit.title = `Edit ${entry.name}`;
    edit.setAttribute('aria-label', `Rename ${entry.name} or change its color`);
    edit.addEventListener('click', () => {
      editingTagName = editingTagName === entry.name ? null : entry.name;
      renderHome();
      if (editingTagName) elements.tagManager.querySelector('.tag-pill-name-edit')?.focus();
    });
    pill.append(edit);
    wrapper.append(pill);

    if (editingTagName === entry.name) {
      const editor = makeElement('div', 'tag-pill-editor');
      const name = document.createElement('input');
      name.className = 'tag-pill-name-edit';
      name.value = entry.name;
      name.setAttribute('aria-label', `Rename tag ${entry.name}`);
      const color = document.createElement('input');
      color.type = 'color';
      color.className = 'tag-pill-color-edit';
      color.value = entry.color;
      color.setAttribute('aria-label', `Change color for ${entry.name}`);
      color.addEventListener('input', () => {
        pill.style.backgroundColor = color.value;
        pill.style.color = tagTextColor(color.value);
        pill.style.borderColor = color.value;
      });
      const save = makeElement('button', 'tag-pill-save', 'Save');
      save.type = 'button';
      save.addEventListener('click', () => saveTagEdit(entry, name, color, save));
      const cancel = makeElement('button', 'tag-pill-cancel', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', () => { editingTagName = null; renderHome(); });
      editor.append(name, color, save, cancel);
      wrapper.append(editor);
    }
    elements.tagManager.append(wrapper);
  }
}

function effectiveSongs(playlist, childrenByParent = null, visited = new Set()) {
  if (visited.has(playlist.id)) return [];
  const nextVisited = new Set(visited);
  nextVisited.add(playlist.id);
  const own = (playlist.songs || []).map((song) => ({ song, origin: playlist, inherited: false }));
  const children = childrenByParent || new Map(library.playlists.map((item) => [item.id, []]));
  if (!childrenByParent) {
    for (const child of library.playlists) {
      const parent = child.parent ? byName(child.parent) : null;
      if (parent) children.get(parent.id).push(child);
    }
    for (const nested of children.values()) nested.sort((left, right) => (left.name || '').localeCompare(right.name || ''));
  }
  const descendants = [];
  for (const child of children.get(playlist.id) || []) {
    descendants.push(...effectiveSongs(child, children, nextVisited).map((entry) => ({ ...entry, inherited: true })));
  }
  return [...own, ...descendants];
}

function addTagToSongEditor(name) {
  const tag = name.trim();
  if (!tag || songTagEditor.tags.some((value) => value.toLocaleLowerCase('en-US') === tag.toLocaleLowerCase('en-US'))) return;
  songTagEditor.tags.push(tag);
  registerTagNames([tag]);
}

function openSongTagEditor(playlist, song) {
  songTagEditor = { file: playlist.id, line: song.line, tags: [...(song.tags || [])], draft: '' };
  renderSongs(playlist);
  setTimeout(() => elements.songList.querySelector('.song-tag-input')?.focus(), 0);
}

function renderSongTagEditor(playlist, song) {
  const editor = makeElement('div', 'song-tag-editor');
  for (const [index, name] of songTagEditor.tags.entries()) {
    editor.append(makeTagChip(name, index, { removable: true, onRemove: () => {
      songTagEditor.tags.splice(index, 1);
      renderSongs(playlist);
      elements.songList.querySelector('.song-tag-input')?.focus();
    } }));
  }
  const input = makeElement('input', 'song-tag-input');
  input.type = 'text';
  input.placeholder = 'Add tag';
  input.setAttribute('aria-label', 'Add tag to song; comma finishes it');
  input.value = songTagEditor.draft;
  const suggestions = makeElement('div', 'tag-suggestions song-tag-suggestions');
  suggestions.hidden = true;
  const showSuggestions = () => renderTagSuggestions(suggestions, input, () => songTagEditor.tags, (name) => {
    addTagToSongEditor(name);
    songTagEditor.draft = '';
    renderSongs(playlist);
    elements.songList.querySelector('.song-tag-input')?.focus();
  });
  input.addEventListener('focus', showSuggestions);
  input.addEventListener('input', () => {
    const parts = input.value.split(',');
    if (parts.length > 1) {
      parts.slice(0, -1).forEach(addTagToSongEditor);
      songTagEditor.draft = parts.at(-1);
      renderSongs(playlist);
      elements.songList.querySelector('.song-tag-input')?.focus();
      return;
    }
    songTagEditor.draft = input.value;
    showSuggestions();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === ',') {
      event.preventDefault();
      addTagToSongEditor(songTagEditor.draft);
      songTagEditor.draft = '';
      renderSongs(playlist);
      elements.songList.querySelector('.song-tag-input')?.focus();
    } else if (event.key === 'ArrowDown' && !suggestions.hidden) {
      event.preventDefault();
      suggestions.querySelector('button')?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      addTagToSongEditor(songTagEditor.draft);
      songTagEditor.draft = '';
      saveSongTagEditor(playlist, song);
    }
  });
  editor.append(input, suggestions);
  const save = makeElement('button', 'song-tag-save', 'Save');
  save.type = 'button';
  save.addEventListener('click', () => {
    addTagToSongEditor(songTagEditor.draft);
    songTagEditor.draft = '';
    saveSongTagEditor(playlist, song);
  });
  const cancel = makeElement('button', 'song-tag-cancel', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => { songTagEditor = null; renderSongs(playlist); });
  editor.append(save, cancel);
  return editor;
}

async function saveSongTagEditor(playlist, song) {
  const tags = [...songTagEditor.tags];
  const button = elements.songList.querySelector('.song-tag-save');
  if (button) button.disabled = true;
  try {
    const result = await requestJson('/api/songs/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: playlist.id, line: song.line, tags }),
    });
    library = result.library;
    tagRegistry = result.tags;
    songTagEditor = null;
    render();
    showToast('Song tags updated.');
  } catch (error) {
    showToast(error.message);
    if (button) button.disabled = false;
  }
}

function renderSongs(playlist) {
  elements.songList.replaceChildren();
  const songs = effectiveSongs(playlist);
  elements.songCount.textContent = String(songs.length);
  elements.songCount.setAttribute('aria-label', `${songs.length} track${songs.length === 1 ? '' : 's'}`);
  elements.noSongs.hidden = songs.length !== 0;
  elements.songList.hidden = songs.length === 0;
  const ownSongIndexes = new Map((playlist.songs || []).map((song, index) => [song.line, index]));
  for (const entry of songs) {
    const song = entry.song;
    const row = makeElement('li', 'song-row');
    const summary = makeElement('div', 'song-summary');
    const primary = song.title || (song.artist ? `Artist: ${song.artist}` : 'Untitled track search');
    summary.append(makeElement('div', 'song-primary', primary));
    if (song.artist && song.title) summary.append(makeElement('div', 'song-secondary', song.artist));
    if (entry.inherited) {
      const origin = makeElement('button', 'song-origin origin-link', `From ${entry.origin.name}`);
      origin.type = 'button';
      origin.addEventListener('click', () => goToPlaylist(entry.origin.id));
      summary.append(origin);
    }
    row.append(summary);

    const tags = makeElement('div', 'song-tags');
    if (!entry.inherited && songTagEditor?.file === playlist.id && songTagEditor.line === song.line) {
      tags.append(renderSongTagEditor(playlist, song));
      row.classList.add('is-editing-tags');
    } else {
      for (const tag of song.tags || []) tags.append(makeMetadataTag(tag));
      if (!entry.inherited) {
        const addTag = makeElement('button', 'song-add-tag', '+ tag');
        addTag.type = 'button';
        addTag.setAttribute('aria-label', `Add tags to ${song.title || song.artist || 'song'}`);
        addTag.addEventListener('click', () => openSongTagEditor(playlist, song));
        tags.append(addTag);
      }
    }
    row.append(tags);

    if (!entry.inherited) {
      const actions = makeElement('div', 'song-actions');
      const remove = makeElement('button', 'song-action song-remove', '×');
      remove.type = 'button';
      remove.title = 'Remove song';
      remove.setAttribute('aria-label', `Remove ${song.title || song.artist || 'song'}`);
      remove.addEventListener('click', () => removePlaylistSong(playlist, song, remove));
      actions.append(remove);
      row.append(actions);

      const sourceIndex = ownSongIndexes.get(song.line);
      row.draggable = true;
      row.dataset.songLine = String(song.line);
      row.addEventListener('dragstart', (event) => {
        draggedSong = { file: playlist.id, line: song.line, fromIndex: sourceIndex };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(song.line));
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => {
        draggedSong = null;
        elements.songList.querySelectorAll('.is-dragging, .drop-target').forEach((item) => item.classList.remove('is-dragging', 'drop-target'));
      });
      row.addEventListener('dragover', (event) => {
        if (!draggedSong || draggedSong.file !== playlist.id || draggedSong.line === song.line) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add('drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
      row.addEventListener('drop', (event) => {
        if (!draggedSong || draggedSong.file !== playlist.id) return;
        event.preventDefault();
        event.stopPropagation();
        row.classList.remove('drop-target');
        const targetIndex = ownSongIndexes.get(song.line);
        const after = event.clientY > row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
        let toIndex = targetIndex + (after ? 1 : 0);
        if (draggedSong.fromIndex < toIndex) toIndex -= 1;
        toIndex = Math.max(0, Math.min(playlist.songs.length - 1, toIndex));
        reorderSong(playlist, draggedSong.line, toIndex);
      });
    } else {
      row.classList.add('is-inherited-song');
    }
    elements.songList.append(row);
  }
}

function normalizeSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US');
}

function matchesSearch(query, fields) {
  const terms = normalizeSearch(query).trim().match(/(?:[^\s"]+:"(?:\\.|[^"\\])*")|"(?:\\.|[^"\\])*"|\S+/g) || [];
  const parsedTerms = terms.map((term) => {
    const filter = term.match(/^(playlist|description|tag|artist|title|isrc|parent):("(?:\\.|[^"\\])*"|.+)$/);
    if (!filter) return { field: 'all', value: term.replace(/^"|"$/g, '') };
    let value = filter[2];
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return { field: filter[1], value };
  });
  return parsedTerms.length > 0 && parsedTerms.every(({ field, value }) => normalizeSearch(fields[field] || '').includes(value));
}

function renderSearchView(query) {
  const sortedPlaylists = [...library.playlists].sort((left, right) => (left.name || '').localeCompare(right.name || ''));
  const playlistMatches = sortedPlaylists.filter((playlist) => {
    const tags = playlist.tags || [];
    return matchesSearch(query, {
      all: [playlist.name, playlist.description, playlist.parent, ...tags].join(' '),
      playlist: playlist.name,
      description: playlist.description,
      tag: tags.join(' '),
      parent: playlist.parent,
    });
  });
  const songMatches = [];
  for (const playlist of sortedPlaylists) {
    for (const song of playlist.songs || []) {
      const songTags = song.tags || [];
      if (matchesSearch(query, {
        all: [song.artist, song.title, song.isrc, ...songTags].join(' '),
        playlist: playlist.name,
        tag: songTags.join(' '),
        artist: song.artist,
        title: song.title,
        isrc: song.isrc,
      })) songMatches.push({ playlist, song });
    }
  }

  elements.librarySearchTitle.textContent = `Results for "${query}"`;
  elements.librarySearchSummary.textContent = `${playlistMatches.length} playlist${playlistMatches.length === 1 ? '' : 's'} and ${songMatches.length} song${songMatches.length === 1 ? '' : 's'} found across your library.`;
  elements.playlistMatchCount.textContent = String(playlistMatches.length);
  elements.songMatchCount.textContent = String(songMatches.length);
  elements.playlistSearchResults.replaceChildren();
  elements.songSearchResults.replaceChildren();
  elements.playlistSearchSection.hidden = playlistMatches.length === 0;
  elements.songSearchSection.hidden = songMatches.length === 0;
  elements.noLibraryMatches.hidden = playlistMatches.length + songMatches.length > 0;

  const maxResults = 40;
  for (const playlist of playlistMatches.slice(0, maxResults)) {
    const button = makeElement('button', 'search-result-card playlist-search-card');
    button.type = 'button';
    button.addEventListener('click', () => goToPlaylist(playlist.id));
    button.append(makeElement('strong', 'search-result-title', playlist.name || 'Unnamed playlist'));
    const detail = playlist.description || (playlist.parent ? `Parent: ${playlist.parent}` : 'Playlist');
    button.append(makeElement('span', 'search-result-detail', detail));
    const tags = makeElement('span', 'search-result-tags');
    for (const tag of playlist.tags || []) tags.append(makeMetadataTag(tag));
    button.append(tags);
    elements.playlistSearchResults.append(button);
  }
  if (playlistMatches.length > maxResults) {
    elements.playlistSearchResults.append(makeElement('p', 'more-search-results', `${playlistMatches.length - maxResults} more playlist matches`));
  }

  for (const { playlist, song } of songMatches.slice(0, maxResults)) {
    const button = makeElement('button', 'search-result-card song-search-card');
    button.type = 'button';
    button.addEventListener('click', () => goToPlaylist(playlist.id));
    const title = song.title || (song.artist ? `Artist: ${song.artist}` : 'Untitled track search');
    button.append(makeElement('strong', 'search-result-title', title));
    if (song.artist && song.title) button.append(makeElement('span', 'search-result-detail', song.artist));
    button.append(makeElement('span', 'search-result-context', `In ${playlist.name}`));
    if (song.tags?.length) {
      const tags = makeElement('span', 'search-result-tags');
      for (const tag of song.tags) tags.append(makeMetadataTag(tag));
      button.append(tags);
    }
    elements.songSearchResults.append(button);
  }
  if (songMatches.length > maxResults) {
    elements.songSearchResults.append(makeElement('p', 'more-search-results', `${songMatches.length - maxResults} more songs`));
  }
}

function render() {
  updateSpotifyDestinationChoices();
  youtubeUI.updateDestinations();
  renderTree();
  renderIssues();

  const query = libraryQuery.trim();
  const isSearchingLibrary = query.length > 0;
  const isSettings = currentSection === 'settings';
  const isExport = currentSection === 'youtube-export';
  const playlist = library.playlists.find((item) => item.id === selectedId);
  const isHome = !isExport && !isSettings && !isSearchingLibrary && !playlist && library.playlists.length > 0;
  elements.librarySearchView.hidden = !isSearchingLibrary;
  elements.homeView.hidden = isSettings || !isHome;
  elements.settingsView.hidden = !isSettings;
  document.getElementById('youtubeExportView').hidden = !isExport;
  elements.emptyState.hidden = isExport || isSettings || isSearchingLibrary || library.playlists.length > 0;
  elements.playlistView.hidden = isExport || isSettings || isSearchingLibrary || !playlist;
  elements.homeButton.classList.toggle('is-active', isHome);
  elements.settingsButton.classList.toggle('is-active', isSettings);
  if (isHome) elements.homeButton.setAttribute('aria-current', 'page');
  else elements.homeButton.removeAttribute('aria-current');
  if (isSettings) elements.settingsButton.setAttribute('aria-current', 'page');
  else elements.settingsButton.removeAttribute('aria-current');
  if (isExport) { youtubeUI.renderExport(exportViewId); return; }
  if (isSettings) return;
  if (isSearchingLibrary) {
    renderSearchView(query);
    return;
  }
  if (!playlist) {
    if (isHome) renderHome();
    return;
  }

  elements.playlistName.textContent = playlist.name || 'Unnamed playlist';
  elements.playlistFile.textContent = 'PLAYLIST';
  elements.playlistDescription.textContent = playlist.description || '';
  elements.playlistDescription.hidden = !playlist.description;
  renderMetadata(playlist);
  renderSongs(playlist);
}

async function addSongToPlaylist(song) {
  if (songSaveInFlight) return false;
  if (!selectedId) {
    setFormError(elements.quickAddError, 'Choose a playlist first.');
    return false;
  }
  songSaveInFlight = true;
  elements.quickAddButton.disabled = true;
  elements.quickAddButton.classList.add('is-saving');
  setFormError(elements.quickAddError, '');
  try {
    const result = await requestJson('/api/songs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: selectedId, ...song }),
    });
    library = result.library;
    tagRegistry = result.tags;
    selectedId = result.file;
    resetComposer();
    render();
    showToast('Song added.');
    return true;
  } catch (error) {
    setFormError(elements.quickAddError, error.message);
    return false;
  } finally {
    songSaveInFlight = false;
    elements.quickAddButton.disabled = false;
    elements.quickAddButton.classList.remove('is-saving');
  }
}

async function updateSong(playlist, song, endpoint, payload, button, successMessage) {
  if (songSaveInFlight) return;
  songSaveInFlight = true;
  const wasDisabled = button?.disabled;
  if (button) button.disabled = true;
  try {
    const result = await requestJson(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: playlist.id, line: song.line, ...payload }),
    });
    library = result.library;
    selectedId = playlist.id;
    render();
    showToast(successMessage);
  } catch (error) {
    showToast(error.message);
  } finally {
    songSaveInFlight = false;
    if (button) button.disabled = wasDisabled;
  }
}

async function changePlaylistParent(file, parent) {
  try {
    const result = await requestJson('/api/playlists/parent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, parent }),
    });
    library = result.library;
    render();
    showToast(parent ? `Moved under ${parent}.` : 'Playlist moved to the root.');
  } catch (error) {
    showToast(error.message);
  }
}

function removePlaylistSong(playlist, song, button) {
  updateSong(playlist, song, '/api/songs/remove', {}, button, 'Song removed.');
}

function reorderSong(playlist, line, toIndex) {
  updateSong(playlist, { line }, '/api/songs/move', { toIndex }, null, 'Song order updated.');
}

function openPlaylistDialog() {
  elements.playlistForm.reset();
  setFormError(elements.playlistFormError, '');
  const select = elements.playlistForm.elements['parent'];
  select.replaceChildren(new Option('No parent playlist', ''));
  for (const playlist of library.playlists) select.add(new Option(playlist.name, playlist.name));
  elements.playlistDialog.showModal();
  elements.playlistForm.elements.name.focus();
}

function openEditPlaylistDialog() {
  const playlist = library.playlists.find((item) => item.id === selectedId);
  if (!playlist) return;
  elements.editPlaylistForm.reset();
  setFormError(elements.editPlaylistFormError, '');
  const form = elements.editPlaylistForm.elements;
  form.name.value = playlist.name || '';
  form.description.value = playlist.description || '';
  form.tags.value = (playlist.tags || []).join(', ');
  const parent = form.parent;
  parent.replaceChildren(new Option('No parent playlist', ''));
  for (const item of library.playlists) {
    if (item.id !== playlist.id) parent.add(new Option(item.name, item.name));
  }
  parent.value = playlist.parent || '';
  elements.editPlaylistDialog.showModal();
  form.name.focus();
  form.name.select();
}

function initializeSidebarResizer() {
  const handle = elements.sidebarResizer;
  const layout = document.querySelector('.main-layout');
  const minWidth = 220;
  const maxWidth = 520;
  let width = 292;
  try {
    const savedWidth = Number(window.localStorage.getItem('playlista-sidebar-width'));
    if (Number.isFinite(savedWidth) && savedWidth > 0) width = savedWidth;
  } catch {}

  const setWidth = (nextWidth, persist = false) => {
    width = Math.max(minWidth, Math.min(maxWidth, Math.round(nextWidth)));
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
    if (persist) {
      try { window.localStorage.setItem('playlista-sidebar-width', String(width)); } catch {}
    }
  };
  setWidth(width);

  let resizing = false;
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizing = true;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('is-resizing-sidebar');
  });
  handle.addEventListener('pointermove', (event) => {
    if (resizing) setWidth(event.clientX - layout.getBoundingClientRect().left);
  });
  const stopResize = () => {
    if (!resizing) return;
    resizing = false;
    setWidth(width, true);
    document.body.classList.remove('is-resizing-sidebar');
  };
  handle.addEventListener('pointerup', stopResize);
  handle.addEventListener('pointercancel', stopResize);
  handle.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') setWidth(width - 16, true);
    else if (event.key === 'ArrowRight') setWidth(width + 16, true);
    else if (event.key === 'Home') setWidth(minWidth, true);
    else if (event.key === 'End') setWidth(maxWidth, true);
    else return;
    event.preventDefault();
  });
}

elements.librarySearchForm.addEventListener('submit', (event) => event.preventDefault());
elements.homeButton.addEventListener('click', goHome);
elements.settingsButton.addEventListener('click', goToSettings);
elements.settingsForm.addEventListener('submit', (event) => saveSettings(event).catch(() => {}));
elements.githubAutoSyncInput.addEventListener('change', async () => {
  elements.githubAutoSyncInput.disabled = true;
  try { await saveSettings(); }
  catch { elements.githubAutoSyncInput.checked = syncStatus?.autoSync === true; }
  finally { elements.githubAutoSyncInput.disabled = false; }
});
elements.spotifyConnectButton.addEventListener('click', connectSpotify);
elements.spotifyDisconnectButton.addEventListener('click', disconnectSpotify);
elements.spotifyLoadPlaylistsButton.addEventListener('click', loadSpotifyPlaylists);
elements.spotifyPlaylistSearch.addEventListener('input', renderSpotifyPlaylists);
window.addEventListener('message', async (event) => {
  if (event.source !== spotifyAuthPopup || event.data?.type !== 'playlista-spotify-auth') return;
  spotifyAuthPopup = null;
  await refreshSpotifyStatus();
  if (event.data.success && spotifyConnected) showToast('Spotify connected.');
  else elements.spotifyAuthStatus.textContent = 'Spotify sign-in was not completed';
});
elements.chooseGithubAccountButton.addEventListener('click', openGithubAccountPicker);
elements.acceptGithubAccountButton.addEventListener('click', acceptGithubAccount);
elements.githubTestButton.addEventListener('click', testGitHubConnection);
elements.githubPullButton.addEventListener('click', () => syncGitHub('pull'));
elements.githubPushButton.addEventListener('click', () => syncGitHub('push'));
elements.resolveWithGitHubButton.addEventListener('click', () => resolveGitHubConflicts('pull'));
elements.resolveWithLocalButton.addEventListener('click', () => resolveGitHubConflicts('push'));
elements.playlistEditButton.addEventListener('click', openEditPlaylistDialog);
elements.playlistSyncButton.addEventListener('click', syncCurrentPlaylist);
window.addEventListener('popstate', (event) => {
  const state = event.state;
  if (!state?.playlistaNavigation || !state.view || !Number.isInteger(state.index)) return;
  appNavigationIndex = state.index;
  appNavigationHistory[appNavigationIndex] = state.view;
  applyNavigation(state.view);
});
elements.homeButton.addEventListener('dragover', (event) => {
  if (!draggedPlaylistId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  elements.homeButton.classList.add('drop-target');
});
elements.homeButton.addEventListener('dragleave', () => elements.homeButton.classList.remove('drop-target'));
elements.homeButton.addEventListener('drop', (event) => {
  event.preventDefault();
  elements.homeButton.classList.remove('drop-target');
  if (draggedPlaylistId) changePlaylistParent(draggedPlaylistId, '');
});
elements.librarySearchInput.addEventListener('input', () => {
  const query = elements.librarySearchInput.value;
  const mode = libraryQuery.trim() && query.trim() ? 'replace' : 'push';
  applyNavigation({ selectedId, query }, { historyMode: mode });
});
elements.clearLibrarySearch.addEventListener('click', () => {
  applyNavigation({ selectedId, query: '' }, { historyMode: 'push' });
  elements.librarySearchInput.focus();
});
document.addEventListener('keydown', (event) => {
  if (!event.altKey && !event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    elements.librarySearchInput.focus();
    elements.librarySearchInput.select();
    return;
  }
  const target = event.target instanceof Element ? event.target : document.activeElement;
  const editing = target?.isContentEditable || Boolean(target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]'));
  const interactive = Boolean(target?.closest('button, a[href], summary, [role="button"]'));
  if (!PlaylistUI.shouldFocusQuickAdd(event, {
    playlistVisible: !elements.playlistView.hidden && Boolean(selectedId),
    modalOpen: Boolean(document.querySelector('dialog[open], [aria-modal="true"]')),
    editing, interactive,
  })) return;
  const input = elements.quickAddEditor.querySelector(`[data-property="${activeComposerProperty}"]`);
  if (!input) return;
  event.preventDefault();
  input.focus({ preventScroll: true });
  input.setRangeText(event.key, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const bounds = elements.quickAddEditor.getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > window.innerHeight) elements.quickAddEditor.scrollIntoView({ block: 'nearest' });
});

document.querySelector('#newPlaylistButton').addEventListener('click', openPlaylistDialog);
document.querySelector('#emptyCreateButton').addEventListener('click', openPlaylistDialog);
document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => document.getElementById(button.dataset.close).close());
});

elements.quickAddForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setFormError(elements.quickAddError, '');
  const tags = [...composer.tags];
  const pendingTag = composer.tagDraft.trim();
  if (pendingTag && !tags.some((tag) => tag.toLocaleLowerCase('en-US') === pendingTag.toLocaleLowerCase('en-US'))) tags.push(pendingTag);
  const song = {
    title: composer.song.trim(),
    artist: composer.artist.trim(),
    tags,
  };
  if (!song.title && !song.artist) {
    setFormError(elements.quickAddError, 'Enter a song or artist.');
    activeComposerProperty = 'song';
    composer.showSongToken = true;
    renderQuickAddEditor({ focus: true });
    return;
  }
  await addSongToPlaylist(song);
});

elements.playlistForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setFormError(elements.playlistFormError, '');
  const form = new FormData(elements.playlistForm);
  const input = {
    name: form.get('name').trim(),
    parent: form.get('parent'),
    description: form.get('description').trim(),
    tags: splitTags(form.get('tags')),
  };
  if (!input.name) {
    setFormError(elements.playlistFormError, 'Give your playlist a name.');
    elements.playlistForm.elements.name.focus();
    return;
  }

  const submit = elements.playlistForm.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Creating...';
  try {
    const result = await requestJson('/api/playlists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    library = result.library;
    tagRegistry = result.tags;
    applyNavigation({ selectedId: result.id, query: '' }, { historyMode: 'push', resetComposerOnNavigate: true });
    elements.playlistDialog.close();
    showToast('Playlist created.');
  } catch (error) {
    setFormError(elements.playlistFormError, error.message);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Create playlist';
  }
});

elements.editPlaylistForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setFormError(elements.editPlaylistFormError, '');
  const playlist = library.playlists.find((item) => item.id === selectedId);
  if (!playlist) return;
  const form = new FormData(elements.editPlaylistForm);
  const input = {
    file: playlist.id,
    name: String(form.get('name') || '').trim(),
    parent: form.get('parent'),
    description: String(form.get('description') || '').trim(),
    tags: splitTags(String(form.get('tags') || '')),
  };
  if (!input.name) {
    setFormError(elements.editPlaylistFormError, 'Give your playlist a name.');
    elements.editPlaylistForm.elements.name.focus();
    return;
  }

  const submit = elements.editPlaylistForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await requestJson('/api/playlists/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    library = result.library;
    tagRegistry = result.tags;
    selectedId = result.file;
    elements.editPlaylistDialog.close();
    render();
    showToast('Playlist updated.');
  } catch (error) {
    setFormError(elements.editPlaylistFormError, error.message);
  } finally {
    submit.disabled = false;
  }
});

renderQuickAddEditor();
initializeNavigationHistory();
initializeSidebarResizer();
refreshLibrary(null);
window.setInterval(checkServerHealth, 5000);
