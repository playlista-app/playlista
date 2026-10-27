/* Local YouTube Music connection and import controls. */
window.createYouTubeUI = function ({ request, getLibrary, getSelectedId, onImport, openSettings, onExportView }) {
  const ids = ['RuntimeStatus', 'AccountStatus', 'DisconnectButton', 'ConnectionDetails', 'HeadersInput', 'CheckButton',
    'AccountPreview', 'PreviewName', 'RememberLabel', 'RememberInput', 'AcceptButton', 'ImportControls', 'LoadButton',
    'TargetSelect', 'NewNameInput', 'UrlInput', 'ImportUrlButton', 'FilterField', 'FilterInput', 'PlaylistList', 'Result'];
  const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(`youtube${id}`)]));
  let connected = false;
  let token = '';
  let playlists = [];
  let importing = false;
  const post = (url, data = {}) => request(`/api/youtube/${url}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  });
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function message(text, error = false) {
    el.Result.hidden = !text;
    el.Result.textContent = text;
    el.Result.classList.toggle('youtube-error', error);
  }
  function showConnection(result) {
    connected = result.connected;
    el.AccountStatus.textContent = connected ? `${result.account.name}${result.account.handle ? ` · ${result.account.handle}` : ''}${result.remembered ? '' : ' · this session'}` : 'Not connected';
    el.DisconnectButton.hidden = !connected;
    el.ImportControls.hidden = !connected;
  }
  async function refresh() {
    try {
      const result = await request('/api/youtube/status');
      showConnection(result);
      el.RuntimeStatus.textContent = result.runtime.available ? '' : result.runtime.error;
      el.RuntimeStatus.hidden = result.runtime.available;
      el.RememberLabel.hidden = !result.canRemember;
      el.RememberInput.checked = result.canRemember;
      if (result.error) message(result.error, true);
      if (!connected) el.ConnectionDetails.open = true;
    } catch (error) { message(error.message, true); }
  }
  async function checkAccount() {
    if (el.CheckButton.disabled) return;
    el.CheckButton.disabled = true;
    el.AccountPreview.hidden = true;
    token = '';
    message('Checking account…');
    const headers = el.HeadersInput.value;
    el.HeadersInput.value = ''; // Credentials never go into localStorage, URLs, or app settings.
    try {
      const result = await post('connect', { headers });
      token = result.token;
      el.PreviewName.textContent = `${result.account.name}${result.account.handle ? ` · ${result.account.handle}` : ''}`;
      el.RememberLabel.hidden = !result.canRemember;
      el.RememberInput.checked = result.canRemember;
      el.AccountPreview.hidden = false;
      message('');
    } catch (error) { message(error.message, true); }
    finally { el.CheckButton.disabled = false; }
  }
  async function acceptAccount() {
    el.AcceptButton.disabled = true;
    try {
      showConnection(await post('accept', { token, remember: !el.RememberLabel.hidden && el.RememberInput.checked }));
      token = '';
      playlists = [];
      el.AccountPreview.hidden = true;
      el.ConnectionDetails.open = false;
      renderPlaylists();
      message('');
    } catch (error) { message(error.message, true); }
    finally { el.AcceptButton.disabled = false; }
  }
  async function disconnect() {
    el.DisconnectButton.disabled = true;
    try {
      await post('disconnect');
      showConnection({ connected: false });
      playlists = [];
      token = '';
      el.HeadersInput.value = '';
      el.AccountPreview.hidden = true;
      el.ConnectionDetails.open = true;
      renderPlaylists();
      message('');
    } catch (error) { message(error.message, true); }
    finally { el.DisconnectButton.disabled = false; }
  }
  function updateDestinations() {
    const previous = el.TargetSelect.value;
    el.TargetSelect.replaceChildren(new Option('New playlist', ''));
    for (const playlist of getLibrary().playlists) el.TargetSelect.add(new Option(playlist.name, playlist.id));
    if ([...el.TargetSelect.options].some((option) => option.value === previous)) el.TargetSelect.value = previous;
    el.NewNameInput.disabled = Boolean(el.TargetSelect.value);
  }
  function renderPlaylists() {
    el.PlaylistList.replaceChildren();
    el.FilterField.hidden = playlists.length === 0;
    const query = el.FilterInput.value.trim().toLocaleLowerCase();
    const matches = playlists.filter((p) => p.name.toLocaleLowerCase().includes(query));
    if (playlists.length && !matches.length) el.PlaylistList.append(element('p', 'spotify-empty-result', 'No matching playlists.'));
    for (const playlist of matches) {
      const row = element('div', 'spotify-playlist-row');
      const details = element('div', 'spotify-playlist-details');
      details.append(element('strong', 'spotify-playlist-name', playlist.name));
      if (playlist.count !== '') details.append(element('span', 'spotify-playlist-count', `${playlist.count} tracks`));
      const button = element('button', 'button button-small button-soft', 'Import');
      button.type = 'button';
      button.disabled = importing;
      button.addEventListener('click', () => importPlaylist(playlist.id));
      row.append(details, button);
      el.PlaylistList.append(row);
    }
  }
  async function loadPlaylists() {
    el.LoadButton.disabled = true;
    message('Loading playlists…');
    try {
      playlists = (await request('/api/youtube/playlists')).playlists;
      renderPlaylists();
      message(playlists.length ? '' : 'No playlists found. You can also import using a playlist URL.');
    } catch (error) { message(error.message, true); }
    finally { el.LoadButton.disabled = false; }
  }
  async function importPlaylist(id) {
    if (importing) return;
    importing = true;
    el.ImportUrlButton.disabled = true;
    renderPlaylists();
    message('Importing songs…');
    try {
      const result = await post('import', { id, file: el.TargetSelect.value, name: el.NewNameInput.disabled ? '' : el.NewNameInput.value.trim() });
      onImport(result);
      el.UrlInput.value = '';
      message(`${result.imported} songs imported${result.skipped ? ` · ${result.skipped} unavailable or non-song items skipped` : ''}.`);
    } catch (error) { message(error.message, true); }
    finally { importing = false; el.ImportUrlButton.disabled = false; renderPlaylists(); }
  }
  const exportUI = window.createYouTubeExportUI({ request, getLibrary, getSelectedId, openSettings, onExportView });
  el.CheckButton.addEventListener('click', checkAccount);
  el.AcceptButton.addEventListener('click', acceptAccount);
  el.DisconnectButton.addEventListener('click', disconnect);
  el.LoadButton.addEventListener('click', loadPlaylists);
  el.TargetSelect.addEventListener('change', updateDestinations);
  el.FilterInput.addEventListener('input', renderPlaylists);
  el.ImportUrlButton.addEventListener('click', () => importPlaylist(el.UrlInput.value));
  // Enter in connection/import controls must not submit the unrelated Settings form.
  [el.HeadersInput, el.UrlInput, el.NewNameInput, el.FilterInput].forEach((input) => input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && input !== el.HeadersInput) {
      event.preventDefault();
      if (input === el.UrlInput) importPlaylist(input.value);
    }
  }));
  return { refresh, updateDestinations, renderExport: exportUI.render };
};
