/* Local browser-session connection and playlist import controls. */
window.createMusicImportUI = function ({ request, getLibrary, onImport, key, label, secretId, secretField, openSettings, onOpenImport }) {
  const ids = ['RuntimeStatus', 'AccountStatus', 'DisconnectButton', 'ConnectionDetails', secretId, 'CheckButton',
    'AccountPreview', 'PreviewName', 'RememberLabel', 'RememberInput', 'AcceptButton', 'ImportControls', 'LoadButton',
    'TargetSelect', 'NewNameInput', 'UrlInput', 'ImportButton', 'FilterField', 'FilterInput', 'PlaylistList', 'Result',
    'SourceLibraryTab', 'SourceUrlTab', 'LibraryPanel', 'UrlPanel', 'DestinationPanel', 'NewDestination', 'ExistingDestination', 'TargetField', 'NameField', 'ConnectionResult', 'ImportUnavailable', 'ImportConnectButton', 'ImportAccountStatus', 'OpenImportButton'];
  const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(`${key}${id}`)]));
  let connected = false;
  let token = '';
  let playlists = [];
  let importing = false;
  let sourceMode = 'library';
  let selected = null;
  const importedIds = new Set();
  const post = (url, data = {}) => request(`/api/${key}/${url}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function setMessage(node, text, error = false) {
    node.hidden = !text;
    node.textContent = text;
    node.classList.toggle('youtube-error', error);
    node.setAttribute('role', error ? 'alert' : 'status');
    if (error && node.getClientRects().length) node.scrollIntoView({ block: 'nearest' });
  }
  const message = (text, error) => setMessage(el.Result, text, error);
  const connectionMessage = (text, error) => setMessage(el.ConnectionResult, text, error);
  function showConnection(result) {
    connected = result.connected;
    const handle = result.account?.handle || result.account?.id;
    el.AccountStatus.textContent = connected ? `${result.account.name}${handle ? ` · ${handle}` : ''}${result.remembered ? '' : ' · this session'}` : 'Not connected';
    el.DisconnectButton.hidden = !connected;
    el.ImportControls.hidden = !connected;
    el.ImportUnavailable.hidden = connected;
    el.ImportAccountStatus.hidden = !connected;
    el.ImportAccountStatus.textContent = connected ? el.AccountStatus.textContent : '';
    el.OpenImportButton.hidden = !connected;
    const exportButton = document.getElementById(`${key}ExportButton`);
    exportButton.hidden = !connected || result.runtime?.available === false;
  }
  async function refresh() {
    try {
      const result = await request(`/api/${key}/status`);
      showConnection(result);
      el.RuntimeStatus.textContent = result.runtime.available ? '' : result.runtime.error;
      el.RuntimeStatus.hidden = result.runtime.available;
      el.RememberLabel.hidden = !result.canRemember;
      el.RememberInput.checked = result.canRemember;
      if (result.error) connectionMessage(result.error, true);
      if (!connected) el.ConnectionDetails.open = true;
      return result;
    } catch (error) { connectionMessage(error.message, true); }
  }
  async function checkAccount() {
    if (el.CheckButton.disabled) return;
    el.CheckButton.disabled = true;
    el.AccountPreview.hidden = true;
    token = '';
    connectionMessage('Checking account…');
    const secret = el[secretId].value;
    el[secretId].value = ''; // Credentials never go into localStorage, URLs, or app settings.
    try {
      const result = await post('connect', { [secretField]: secret });
      token = result.token;
      el.PreviewName.textContent = `${result.account.name}${result.account.handle || result.account.id ? ` · ${result.account.handle || result.account.id}` : ''}`;
      el.RememberLabel.hidden = !result.canRemember;
      el.RememberInput.checked = result.canRemember;
      el.AccountPreview.hidden = false;
      connectionMessage('');
    } catch (error) { connectionMessage(error.message, true); }
    finally { el.CheckButton.disabled = false; }
  }
  async function acceptAccount() {
    el.AcceptButton.disabled = true;
    try {
      showConnection(await post('accept', { token, remember: !el.RememberLabel.hidden && el.RememberInput.checked }));
      token = '';
      playlists = [];
      selected = null;
      importedIds.clear();
      el.UrlInput.value = el.NewNameInput.value = '';
      el.AccountPreview.hidden = true;
      el.ConnectionDetails.open = false;
      renderPlaylists();
      message('');
      connectionMessage('');
    } catch (error) { connectionMessage(error.message, true); }
    finally { el.AcceptButton.disabled = false; }
  }
  async function disconnect() {
    el.DisconnectButton.disabled = true;
    try {
      await post('disconnect');
      showConnection({ connected: false });
      playlists = [];
      selected = null;
      importedIds.clear();
      el.UrlInput.value = el.NewNameInput.value = '';
      token = '';
      el[secretId].value = '';
      el.AccountPreview.hidden = true;
      el.ConnectionDetails.open = true;
      renderPlaylists();
      message('');
      connectionMessage('');
    } catch (error) { connectionMessage(error.message, true); }
    finally { el.DisconnectButton.disabled = false; }
  }
  function sourceId() { return sourceMode === 'url' ? el.UrlInput.value.trim() : selected?.id || ''; }
  function updateImportState() {
    const existing = el.ExistingDestination.checked;
    el.NameField.hidden = existing;
    el.TargetField.hidden = !existing;
    el.NewNameInput.disabled = existing || importing;
    el.TargetSelect.disabled = !existing || importing;
    el.DestinationPanel.hidden = !sourceId();
    el.ImportButton.disabled = importing || !sourceId() || (existing && !el.TargetSelect.value);
    el.ImportButton.textContent = importing ? 'Importing...' : existing ? 'Add songs to playlist' : 'Import playlist';
    el.SourceLibraryTab.disabled = el.SourceUrlTab.disabled = importing;
    el.NewDestination.disabled = importing;
    el.ExistingDestination.disabled = importing || getLibrary().playlists.length === 0;
    el.UrlInput.disabled = importing;
    el.NewNameInput.placeholder = (sourceMode === 'library' && selected?.name) || 'Uses the source playlist name';
  }
  function updateDestinations() {
    const previous = el.TargetSelect.value;
    el.TargetSelect.replaceChildren(new Option('Choose a playlist', ''));
    for (const playlist of getLibrary().playlists) el.TargetSelect.add(new Option(playlist.name, playlist.id));
    if ([...el.TargetSelect.options].some((option) => option.value === previous)) el.TargetSelect.value = previous;
    if (!getLibrary().playlists.length) el.NewDestination.checked = true;
    updateImportState();
  }
  function setSourceMode(mode) {
    sourceMode = mode;
    el.SourceLibraryTab.setAttribute('aria-pressed', String(mode === 'library'));
    el.SourceUrlTab.setAttribute('aria-pressed', String(mode === 'url'));
    el.LibraryPanel.hidden = mode !== 'library';
    el.UrlPanel.hidden = mode !== 'url';
    updateImportState();
    if (mode === 'url') el.UrlInput.focus();
  }
  function renderPlaylists() {
    el.PlaylistList.replaceChildren();
    el.FilterField.hidden = playlists.length === 0;
    const query = el.FilterInput.value.trim().toLocaleLowerCase();
    const matches = playlists.filter((p) => p.name.toLocaleLowerCase().includes(query));
    if (playlists.length && !matches.length) el.PlaylistList.append(element('p', 'spotify-empty-result', 'No matching playlists.'));
    for (const playlist of matches) {
      const row = element('button', 'spotify-playlist-row import-source-row');
      row.type = 'button';
      row.disabled = importing;
      row.setAttribute('aria-pressed', String(selected?.id === playlist.id));
      const details = element('span', 'spotify-playlist-details');
      details.append(element('strong', 'spotify-playlist-name', playlist.name));
      const count = playlist.count ?? playlist.total;
      if (count !== '' && count != null) details.append(element('span', 'spotify-playlist-count', `${count} tracks`));
      row.append(details);
      if (importedIds.has(playlist.id)) row.append(element('span', 'music-import-badge', 'Imported'));
      row.append(element('span', 'import-source-check', selected?.id === playlist.id ? '\u2713' : ''));
      row.addEventListener('click', () => {
        selected = playlist;
        el.NewNameInput.value = '';
        renderPlaylists();
        updateImportState();
      });
      el.PlaylistList.append(row);
    }
    updateImportState();
  }
  async function loadPlaylists() {
    el.LoadButton.disabled = true;
    message('Loading playlists...');
    try {
      playlists = (await request(`/api/${key}/playlists`)).playlists;
      if (selected) selected = playlists.find((item) => item.id === selected.id) || null;
      renderPlaylists();
      message(playlists.length ? '' : 'No playlists found. Try a playlist link.');
      el.LoadButton.textContent = 'Refresh playlists';
    } catch (error) { message(error.message, true); }
    finally { el.LoadButton.disabled = false; }
  }
  async function importPlaylist() {
    if (importing || el.ImportButton.disabled) return;
    const id = sourceId();
    const selection = selected;
    const file = el.ExistingDestination.checked ? el.TargetSelect.value : '';
    const name = file ? '' : el.NewNameInput.value.trim() || (sourceMode === 'library' && selected?.name) || '';
    importing = true;
    renderPlaylists();
    message('Importing songs...');
    try {
      const result = await post('import', { id, file, name });
      importedIds.add(id);
      selected = null;
      el.UrlInput.value = '';
      el.NewNameInput.value = '';
      onImport(result);
      message(`${result.imported} songs imported${result.skipped ? ` \u00b7 ${result.skipped} unavailable or non-song items skipped` : ''}.`);
    } catch (error) { selected = selection; message(error.message, true); }
    finally { importing = false; renderPlaylists(); }
  }
  el.ImportConnectButton.addEventListener('click', () => openSettings(key));
  el.OpenImportButton.addEventListener('click', () => onOpenImport(key));
  el.CheckButton.addEventListener('click', checkAccount);
  el.AcceptButton.addEventListener('click', acceptAccount);
  el.DisconnectButton.addEventListener('click', disconnect);
  el.LoadButton.addEventListener('click', loadPlaylists);
  el.TargetSelect.addEventListener('change', updateImportState);
  el.FilterInput.addEventListener('input', renderPlaylists);
  el.ImportButton.addEventListener('click', importPlaylist);
  el.SourceLibraryTab.addEventListener('click', () => setSourceMode('library'));
  el.SourceUrlTab.addEventListener('click', () => setSourceMode('url'));
  el.UrlInput.addEventListener('input', updateImportState);
  el.NewDestination.addEventListener('change', updateImportState);
  el.ExistingDestination.addEventListener('change', updateImportState);
  // Enter in connection/import controls must not submit the unrelated Settings form.
  [el[secretId], el.UrlInput, el.NewNameInput, el.FilterInput].forEach((input) => input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && input !== el[secretId]) {
      event.preventDefault();
      if (input === el.UrlInput) importPlaylist();
    }
  }));
  return { refresh, updateDestinations, isConnected: () => connected };
};
