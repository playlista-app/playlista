window.createMusicExportUI = function ({ request, getLibrary, getSelectedId, openSettings, onExportView, key = 'youtube', label = 'YouTube Music' }) {
  const ids = ['Button', 'Heading', 'Progress', 'Stats', 'Rows', 'Error', 'Result', 'Cancel', 'Filter', 'Pagination', 'Previous', 'Next', 'Page'];
  const el = Object.fromEntries(ids.map((id) => [id, document.getElementById(`${key}Export${id}`)]));
  const reports = new Map();
  const pageSize = 50;
  let runningId = null;
  let displayedId = null;
  let opening = false;
  const post = (action, body) => request(`/api/${key}/${action}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function showError(text) { el.Error.textContent = text; el.Error.hidden = !text; }
  function renderRows(report) {
    el.Rows.replaceChildren();
    const rows = (report.result?.rows || []).filter((row) => report.filter === 'matched' ? row.match : report.filter === 'skipped' ? !row.match : true);
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    report.page = Math.min(report.page, pages - 1);
    for (const row of rows.slice(report.page * pageSize, (report.page + 1) * pageSize)) {
      const card = element('div', 'youtube-export-row');
      const source = element('div', 'youtube-export-track');
      source.append(element('strong', '', `${row.index + 1}. ${row.title || row.artist}`));
      if (row.title && row.artist) source.append(element('span', '', row.artist));
      source.append(element('span', 'youtube-track-origin', row.origin));
      const target = element('div', 'youtube-export-track');
      if (row.match) {
        const link = element('a', '', row.match.title);
        link.href = key === 'spotify' ? `https://open.spotify.com/track/${encodeURIComponent(row.match.id)}` : `https://music.youtube.com/watch?v=${encodeURIComponent(row.match.id)}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        target.append(link, element('span', '', row.match.artist));
        if (row.status === 'unverified') target.append(element('span', 'youtube-error', 'Not fully verified'));
      } else {
        target.append(element('strong', '', row.status === 'search-failed' ? 'Search failed' : row.status === 'not-found' ? 'Not found' : 'Skipped'));
        if (row.reason) target.append(element('span', 'youtube-track-origin', row.reason));
      }
      card.append(source, element('span', 'youtube-export-arrow', '→'), target);
      el.Rows.append(card);
    }
    if (report.result && !rows.length) el.Rows.append(element('p', 'youtube-export-empty', 'No songs in this view.'));
    el.Pagination.hidden = pages <= 1;
    el.Page.textContent = `${report.page + 1} / ${pages}`;
    el.Previous.disabled = report.page === 0;
    el.Next.disabled = report.page + 1 >= pages;
  }
  function render(id) {
    displayedId = id;
    const report = reports.get(id);
    el.Rows.replaceChildren();
    el.Stats.replaceChildren();
    el.Result.hidden = true;
    el.Pagination.hidden = true;
    el.Cancel.hidden = true;
    el.Filter.disabled = true;
    showError('');
    if (!report) {
      el.Heading.textContent = 'Export results';
      el.Progress.textContent = 'These export results are no longer available.';
      return;
    }
    el.Heading.textContent = report.name;
    const account = `${report.account.name}${report.account.handle || report.account.id ? ` (${report.account.handle || report.account.id})` : ''}`;
    el.Progress.textContent = report.status === 'matching' ? `${account} · Matching ${report.completed} / ${report.total} songs…`
      : report.status === 'exporting' || report.status === 'ready' ? `${account} · Creating ${key === 'youtube' ? 'private ' : ''}playlist…`
      : report.status === 'cancelled' ? 'Export cancelled.' : account;
    el.Cancel.hidden = report.status !== 'matching';
    el.Cancel.disabled = false;
    showError(report.error || '');
    if (!report.result) return;
    const result = report.result;
    for (const [label, count] of [['Songs', report.total], [result.complete ? 'Exported' : 'Matched', result.complete ? result.added : result.matched], ['Skipped / not found', result.skipped]]) {
      const stat = element('div', 'overview-stat');
      stat.append(element('strong', 'overview-stat-value', count), element('span', 'overview-stat-label', label));
      el.Stats.append(stat);
    }
    el.Filter.disabled = false;
    el.Filter.value = report.filter;
    el.Result.replaceChildren();
    if (result.warning) el.Result.append(element('p', '', result.warning));
    if (result.url) {
      const link = element('a', '', `Open playlist in ${label}`);
      link.href = result.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      el.Result.append(link);
    } else el.Result.append(element('span', '', 'No playlist created — no songs could be matched.'));
    el.Result.hidden = false;
    renderRows(report);
  }
  async function poll(id) {
    if (runningId !== id) return;
    try {
      const result = await request(`/api/${key}/export?id=${encodeURIComponent(id)}&summary=true`);
      if (runningId !== id) return;
      Object.assign(reports.get(id), result);
      if (displayedId === id) render(id);
      if (['matching', 'ready', 'exporting'].includes(result.status)) setTimeout(() => poll(id), 800);
      else { runningId = null; el.Button.disabled = false; }
    } catch (error) {
      const report = reports.get(id);
      report.error = `${error.message} Check the music service before starting another export.`;
      report.status = 'failed';
      runningId = null;
      el.Button.disabled = false;
      if (displayedId === id) render(id);
    }
  }
  async function open() {
    if (opening || runningId) return;
    opening = true;
    el.Button.disabled = true;
    const file = getSelectedId();
    try {
      const status = await request(`/api/${key}/status`);
      if (!status.connected || !status.runtime.available) {
        await openSettings();
        const details = document.getElementById(`${key}ConnectionDetails`);
        details.open = true;
        details.scrollIntoView({ block: 'center' });
        return;
      }
      const plan = await post('export/prepare', { file, automatic: true });
      reports.set(plan.id, { ...plan, filter: 'all', page: 0 });
      runningId = plan.id;
      onExportView(plan.id);
      poll(plan.id);
    } catch (error) {
      const id = `failed-${Date.now()}`;
      reports.set(id, { name: getLibrary().playlists.find((p) => p.id === file)?.name || 'Export', account: { name: label }, status: 'failed', error: error.message, filter: 'all', page: 0 });
      onExportView(id);
    } finally { opening = false; el.Button.disabled = Boolean(runningId); }
  }
  el.Button.addEventListener('click', open);
  el.Cancel.addEventListener('click', async () => {
    const id = displayedId;
    el.Cancel.disabled = true;
    try {
      await post('export/cancel', { id });
      reports.get(id).status = 'cancelled';
      if (runningId === id) runningId = null;
      el.Button.disabled = false;
      if (displayedId === id) render(id);
    } catch (error) { if (displayedId === id) showError(error.message); el.Cancel.disabled = false; }
  });
  el.Filter.addEventListener('change', () => {
    const report = reports.get(displayedId);
    if (!report) return;
    report.filter = el.Filter.value;
    report.page = 0;
    renderRows(report);
  });
  for (const [button, delta] of [[el.Previous, -1], [el.Next, 1]]) button.addEventListener('click', () => {
    const report = reports.get(displayedId);
    if (!report) return;
    report.page = Math.max(0, report.page + delta);
    renderRows(report);
    el.Rows.scrollIntoView({ block: 'start' });
  });
  return { render };
};
