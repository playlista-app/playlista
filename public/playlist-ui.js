/* Shared by the browser and the focused UI regression tests. */
function formatPlaylistDate(value, now = new Date(), locale) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { label: value, full: value };
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const elapsed = now.getTime() - date.getTime();
  let label;
  if (elapsed >= 0 && elapsed < hour) label = 'Less than an hour ago';
  else if (elapsed >= hour && elapsed < day) {
    const hours = Math.floor(elapsed / hour);
    label = `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else if (elapsed >= day && elapsed < 30 * day) {
    const days = Math.floor(elapsed / day);
    label = `${days} day${days === 1 ? '' : 's'} ago`;
  } else {
    label = new Intl.DateTimeFormat(locale, date.getFullYear() === now.getFullYear()
      ? { month: 'long', day: 'numeric' }
      : { month: 'long', year: 'numeric' }).format(date);
  }
  const full = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(date);
  return { label, full };
}

function shouldFocusQuickAdd(event, { playlistVisible, editing = false, modalOpen = false, interactive = false } = {}) {
  const altGraph = event.getModifierState?.('AltGraph');
  return Boolean(playlistVisible && !editing && !modalOpen && !event.defaultPrevented && !event.isComposing
    && !event.metaKey && (!(event.ctrlKey || event.altKey) || altGraph)
    && typeof event.key === 'string' && Array.from(event.key).length === 1
    && !(event.key === ' ' && interactive));
}

const playlistUI = { formatPlaylistDate, shouldFocusQuickAdd };
if (typeof module !== 'undefined' && module.exports) module.exports = playlistUI;
else window.PlaylistUI = playlistUI;
