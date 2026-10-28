const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const semver = require('semver');
const { gh, api, isNotFound } = require('./github-api');
const { releaseAssets } = require('../website/downloads');

const source = 'playlista-app/playlista';
const target = 'playlista-app/playlista-app.github.io';
const required = ['windows', 'portable', 'mac-arm64', 'mac-x64', 'linux', 'linux-archive'];

function downloadableAssets(release) {
  if (!release || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name || '') || !semver.valid(release.tag_name.slice(1))) throw new Error('Choose a complete stable release tag such as v1.0.3.');
  const version = release.tag_name.slice(1);
  const files = (release.assets || []).filter((asset) => new RegExp(`^Playlista-${version.replace(/\./g, '\\.')}-(?:windows-x64-(?:setup|portable)\\.exe|mac-(?:arm64|x64)\\.(?:dmg|zip)|linux-x64\\.(?:AppImage|tar\\.gz))$`).test(asset.name));
  const published = releaseAssets({ tag_name: release.tag_name, assets: files.map((asset) => ({ ...asset, browser_download_url: `https://github.com/${target}/releases/download/${release.tag_name}/${asset.name}` })) });
  if (!required.every((key) => published[key]) || files.some((asset) => !(asset.size > 0))) throw new Error('The source release is missing desktop builds. Wait for every build and smoke test to pass.');
  if (!release.assets.some((asset) => asset.name === 'SHA256SUMS.txt')) throw new Error('The source release has no SHA256SUMS.txt.');
  return [...files.map((asset) => asset.name), 'SHA256SUMS.txt'];
}

async function publish(tag, dryRun) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) throw new Error('Usage: npm run release:publish -- v1.0.3 [--dry-run]');
  const release = api('GET', `repos/${source}/releases/tags/${tag}`);
  const names = downloadableAssets(release);
  if (dryRun) { console.log(`Would verify and publish ${names.length} files from ${source}/${tag} to ${target}. No remote state changed.`); return; }
  let existing;
  try { existing = api('GET', `repos/${target}/releases/tags/${tag}`); }
  catch (error) { if (!isNotFound(error)) throw error; }
  if (existing && !existing.draft) throw new Error('This public release is already published; it will not be overwritten.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-public-release-'));
  try {
    gh(['release', 'download', tag, '--repo', source, '--dir', directory, '--pattern', 'Playlista-*', '--pattern', 'SHA256SUMS.txt']);
    const lines = (await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')).trim().split(/\r?\n/);
    const checksums = new Map(lines.map((line) => { const match = /^([a-f0-9]{64})\s+\*?([A-Za-z0-9._+-]+)$/.exec(line); if (!match) throw new Error('Invalid checksum manifest.'); return [match[2], match[1]]; }));
    for (const name of names.filter((name) => name !== 'SHA256SUMS.txt')) {
      const data = await fs.readFile(path.join(directory, name));
      if (createHash('sha256').update(data).digest('hex') !== checksums.get(name)) throw new Error(`Checksum verification failed: ${name}`);
    }
    if (!existing) {
      const notes = path.join(directory, 'notes.md');
      await fs.writeFile(notes, `Playlista ${tag.slice(1)} for Windows, macOS (Intel and Apple Silicon), and Linux.\n\nAll platform builds passed their packaged smoke tests. Checksums are in SHA256SUMS.txt.\n\nInstall the Windows setup executable or use the portable executable. On Mac, select the DMG matching your processor. Linux downloads are x64 AppImage and tar.gz builds.\n\nBuilds may be unsigned/ad-hoc unless release signing has been configured. GitHub backup requires GitHub CLI; music helpers are bundled. Third-party notices are included with the app.\n`);
      gh(['release', 'create', tag, '--repo', target, '--draft', '--title', `Playlista ${tag.slice(1)}`, '--notes-file', notes]);
    }
    gh(['release', 'upload', tag, '--repo', target, '--clobber', ...names.map((name) => path.join(directory, name))]);
    // Publication is the last step: partial transfers never appear as releases/latest.
    gh(['release', 'edit', tag, '--repo', target, '--draft=false', '--latest']);
    console.log(`Public downloads published: https://github.com/${target}/releases/tag/${tag}`);
    try {
      const published = api('GET', `repos/${target}/releases/tags/${tag}`);
      const snapshot = { tag_name: tag, assets: published.assets.map(({ name, browser_download_url, size, state }) => ({ name, browser_download_url, size, state })) };
      const previous = api('GET', `repos/${target}/contents/releases.json`);
      api('PUT', `repos/${target}/contents/releases.json`, { message: `Update downloads for ${tag}`, content: Buffer.from(JSON.stringify(snapshot) + '\n').toString('base64'), sha: previous.sha });
    } catch { console.warn('Release published. Run npm run site:publish to refresh the static download snapshot; the live release links already update automatically.'); }
  } finally {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('playlista-public-release-')) throw new Error('Unsafe release cleanup.');
    await fs.rm(directory, { recursive: true, force: true });
  }
}

if (require.main === module) publish(process.argv.slice(2).find((arg) => !arg.startsWith('-')), process.argv.includes('--dry-run')).catch((error) => { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; });
module.exports = { downloadableAssets };
