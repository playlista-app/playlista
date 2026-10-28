const semver = require('semver');
const { gh, api } = require('./github-api');
const { releaseAssets, repository } = require('../website/downloads');

const required = ['windows', 'portable', 'mac-arm64', 'mac-x64', 'linux', 'linux-archive'];

function downloadableAssets(release) {
  if (!release || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name || '') || !semver.valid(release.tag_name.slice(1))) throw new Error('Choose a complete stable release tag such as v1.0.3.');
  const version = release.tag_name.slice(1);
  const files = (release.assets || []).filter((asset) => new RegExp(`^Playlista-${version.replace(/\./g, '\\.')}-(?:windows-x64-(?:setup|portable)\\.exe|mac-(?:arm64|x64)\\.(?:dmg|zip)|linux-x64\\.(?:AppImage|tar\\.gz))$`).test(asset.name));
  const available = releaseAssets({ tag_name: release.tag_name, assets: files.map((asset) => ({ ...asset, browser_download_url: `https://github.com/${repository}/releases/download/${release.tag_name}/${asset.name}` })) });
  if (!required.every((key) => available[key]) || files.some((asset) => !(asset.size > 0))) throw new Error('The release is missing desktop builds. Wait for every build and smoke test to pass.');
  if (!release.assets.some((asset) => asset.name === 'SHA256SUMS.txt')) throw new Error('The release has no SHA256SUMS.txt.');
  return [...files.map((asset) => asset.name), 'SHA256SUMS.txt'];
}

function publish(tag, dryRun) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('Usage: npm run release:publish -- v1.0.3 [--dry-run]');
  if (api('GET', `repos/${repository}`).private) throw new Error('The app repository must be public for website downloads. Its visibility was not changed.');
  const release = api('GET', `repos/${repository}/releases/tags/${tag}`);
  const names = downloadableAssets(release);
  const url = `https://github.com/${repository}/releases/tag/${tag}`;
  if (dryRun) { console.log(`Would publish ${tag} with ${names.length} verified platform/checksum entries in ${repository}. No remote state changed.`); return; }
  if (release.draft) gh(['release', 'edit', tag, '--repo', repository, '--draft=false', '--latest']);
  console.log(`App release: ${url}`);
  try {
    const published = api('GET', `repos/${repository}/releases/tags/${tag}`);
    const snapshot = { tag_name: tag, assets: published.assets.map(({ name, browser_download_url, size, state }) => ({ name, browser_download_url, size, state })) };
    const site = 'playlista-app/playlista-app.github.io';
    const previous = api('GET', `repos/${site}/contents/releases.json`);
    api('PUT', `repos/${site}/contents/releases.json`, { message: `Update app downloads for ${tag}`, content: Buffer.from(JSON.stringify(snapshot) + '\n').toString('base64'), sha: previous.sha });
  } catch { console.warn('Run npm run site:publish to refresh the static snapshot. Live download links already read the app repository.'); }
}

if (require.main === module) {
  try { publish(process.argv.slice(2).find((arg) => !arg.startsWith('-')), process.argv.includes('--dry-run')); }
  catch (error) { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; }
}
module.exports = { downloadableAssets };
