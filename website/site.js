const previews = {
  playlist: { alt: 'Playlista showing a sample Skatepark Anthems playlist, its tags, inline quick add, and the playlist hierarchy in the sidebar.', caption: 'Quick add · drag and drop · song tags' },
  library: { alt: 'Playlista library overview with sample playlists, track counts, and shared tags.', caption: 'Playlist families · shared tags · library search' },
};
const tabs = [...document.querySelectorAll('[data-preview]')];
function showPreview(tab) {
  const name = tab.dataset.preview;
  for (const item of tabs) { item.setAttribute('aria-selected', String(item === tab)); item.tabIndex = item === tab ? 0 : -1; }
  document.querySelector('#app-preview').setAttribute('aria-labelledby', tab.id);
  const image = document.querySelector('#appScreenshot');
  image.src = `assets/${name}.webp`;
  image.alt = previews[name].alt;
  document.querySelector('#previewCaption').textContent = previews[name].caption;
}
for (const tab of tabs) {
  tab.addEventListener('click', () => showPreview(tab));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    showPreview(next); next.focus();
  });
}
