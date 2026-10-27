window.createYouTubeUI = function (options) {
  const imports = window.createMusicImportUI({ ...options, key: 'youtube', label: 'YouTube Music', secretId: 'HeadersInput', secretField: 'headers' });
  const exports = window.createMusicExportUI({ ...options, key: 'youtube', label: 'YouTube Music' });
  return { ...imports, renderExport: exports.render };
};
