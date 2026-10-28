(function (root) {
  'use strict';
  const repository = 'playlista-app/playlista';
  const releasePage = `https://github.com/${repository}/releases`;
  const patterns = {
    windows: /^Playlista-[\d][\w.+-]*-windows-x64-setup\.exe$/,
    portable: /^Playlista-[\d][\w.+-]*-windows-x64-portable\.exe$/,
    'mac-arm64': /^Playlista-[\d][\w.+-]*-mac-arm64\.dmg$/,
    'mac-x64': /^Playlista-[\d][\w.+-]*-mac-x64\.dmg$/,
    linux: /^Playlista-[\d][\w.+-]*-linux-x64\.AppImage$/,
    'linux-archive': /^Playlista-[\d][\w.+-]*-linux-x64\.tar\.gz$/,
  };
  function detectPlatform({ platform = '', userAgent = '', maxTouchPoints = 0 } = {}) {
    if (/Android|iPhone|iPad|iPod/i.test(userAgent) || (/Mac/i.test(platform) && maxTouchPoints > 1)) return null;
    if (/Win/i.test(platform)) return 'windows';
    if (/Mac/i.test(platform)) return 'mac';
    if (/Linux/i.test(platform) && !/CrOS/i.test(userAgent)) return 'linux';
    return null;
  }
  function releaseAssets(release) {
    if (!release || release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(release.tag_name || '')) return {};
    const result = {};
    for (const asset of release.assets || []) {
      if (asset.state && asset.state !== 'uploaded') continue;
      let url;
      try { url = new URL(asset.browser_download_url); } catch { continue; }
      const path = `/${repository}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(asset.name)}`;
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.pathname !== path || url.search || url.hash) continue;
      for (const [key, pattern] of Object.entries(patterns)) if (pattern.test(asset.name)) result[key] = url.href;
    }
    return result;
  }
  const api = { detectPlatform, releaseAssets, repository, releasePage, patterns };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root.document) return;

  const platform = detectPlatform(root.navigator);
  for (const card of document.querySelectorAll('[data-platform]')) {
    const selected = card.dataset.platform === platform;
    card.classList.toggle('is-recommended', selected);
    card.querySelector('.your-system').hidden = !selected;
  }
  function render(release) {
    const assets = releaseAssets(release);
    const labels = { windows: 'Download installer', portable: 'Portable version', 'mac-arm64': 'Apple Silicon', 'mac-x64': 'Intel Mac', linux: 'Download AppImage', 'linux-archive': 'Download .tar.gz' };
    for (const link of document.querySelectorAll('[data-asset]')) {
      const key = link.dataset.asset;
      link.href = assets[key] || releasePage;
      link.classList.toggle('is-unavailable', !assets[key] && link.classList.contains('secondary-download'));
      if (link.classList.contains('button')) link.textContent = assets[key] ? `${labels[key]} ↓` : 'View releases ↗';
      else link.textContent = labels[key];
    }
    const available = Object.keys(assets).length > 0;
    document.querySelector('#releaseStatus').textContent = available ? `Latest release ${release.tag_name}` : 'Desktop downloads are being prepared. Check back soon.';
    const main = document.querySelector('#primaryDownload');
    if (platform === 'windows' && assets.windows) { main.href = assets.windows; main.textContent = 'Download for Windows ↓'; }
    else if (platform === 'linux' && assets.linux) { main.href = assets.linux; main.textContent = 'Download for Linux ↓'; }
    else { main.href = '#downloads'; main.textContent = platform === 'mac' ? 'Download for Mac ↓' : 'Get Playlista ↓'; }
  }
  async function request(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error('Release information unavailable');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function initialize() {
    let cached;
    const cacheKey = `playlista-release:${repository}`;
    try { cached = JSON.parse(sessionStorage.getItem(cacheKey)); } catch {}
    render(cached?.release || null);
    if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) return;
    try { render(await request('releases.json')); } catch {}
    try {
      const release = await request(`https://api.github.com/repos/${repository}/releases/latest`);
      render(release);
      if (Object.keys(releaseAssets(release)).length) {
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ release, fetchedAt: Date.now() })); } catch {}
      }
    } catch { /* Keep the static snapshot if GitHub is offline or rate-limited. */ }
  }
  initialize();
})(typeof window === 'undefined' ? {} : window);
