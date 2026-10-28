const fs = require('node:fs/promises');
const path = require('node:path');
const { api, isNotFound } = require('./github-api');

const repository = 'playlista-app/playlista-app.github.io';
const source = path.resolve(__dirname, '../website');

async function siteFiles(directory = source, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Refusing to publish a symlink: ${relative}`);
    if (entry.isDirectory()) result.push(...await siteFiles(path.join(directory, entry.name), `${relative}/`));
    else if (entry.isFile()) {
      if (!/\.(html|css|js|json|svg|webp|lista)$/.test(entry.name) && entry.name !== '.nojekyll') throw new Error(`Unexpected website file: ${relative}`);
      const content = await fs.readFile(path.join(directory, entry.name));
      if (content.length > 3 * 1024 * 1024) throw new Error(`Website asset is unexpectedly large: ${relative}`);
      result.push({ path: relative, content });
    }
  }
  return result;
}

async function publish({ dryRun = false } = {}) {
  const files = await siteFiles();
  for (const required of ['index.html', 'style.css', 'downloads.js', 'assets/playlist.webp', 'assets/library.webp']) {
    if (!files.some((file) => file.path === required)) throw new Error(`Missing website file: ${required}`);
  }
  if (dryRun) { console.log(`Would publish ${files.length} website files to ${repository}. No repository or Pages settings changed.`); return; }
  let repo;
  let created = false;
  try { repo = api('GET', `repos/${repository}`); }
  catch (error) {
    if (!isNotFound(error)) throw error;
    repo = api('POST', 'orgs/playlista-app/repos', { name: 'playlista-app.github.io', private: false, auto_init: true, description: 'The Playlista website and public desktop downloads.', homepage: 'https://playlista-app.github.io/', has_issues: true, has_projects: false, has_wiki: false });
    created = true;
  }
  if (repo.private) throw new Error('The Pages/download repository must be public. Its visibility was not changed.');
  try {
    const latest = api('GET', `repos/${repository}/releases/latest`);
    const snapshot = { tag_name: latest.tag_name, assets: latest.assets.map(({ name, browser_download_url, size, state }) => ({ name, browser_download_url, size, state })) };
    files.find((file) => file.path === 'releases.json').content = Buffer.from(JSON.stringify(snapshot) + '\n');
  } catch (error) { if (!isNotFound(error)) throw error; }
  const branch = repo.default_branch;
  let previous;
  try {
    const marker = api('GET', `repos/${repository}/contents/.playlista-site.json?ref=${encodeURIComponent(branch)}`);
    previous = JSON.parse(Buffer.from(marker.content, 'base64').toString('utf8'));
  } catch (error) { if (!isNotFound(error)) throw error; }
  if (!created && previous?.generator !== 'playlista/website') throw new Error('The existing repository is not managed by this publisher. No content was changed.');
  files.push({ path: 'README.md', content: Buffer.from('# Playlista\n\nYour playlists, yours to keep.\n\nVisit **https://playlista-app.github.io/** for the app overview and desktop downloads.\n\nThis repository hosts the public website and release binaries. Website source is maintained in the application monorepo under `website/` and deployed with `npm run site:publish`. Generated files should be changed there.\n') });
  const names = files.map((file) => file.path);
  files.push({ path: '.playlista-site.json', content: Buffer.from(JSON.stringify({ generator: 'playlista/website', files: names }, null, 2) + '\n') });
  const ref = api('GET', `repos/${repository}/git/ref/heads/${encodeURIComponent(branch)}`);
  const commit = api('GET', `repos/${repository}/git/commits/${ref.object.sha}`);
  const tree = [];
  for (const file of files) {
    const blob = api('POST', `repos/${repository}/git/blobs`, { content: file.content.toString('base64'), encoding: 'base64' });
    tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const old of previous?.files || []) {
    if (!names.includes(old)) {
      if (old.includes('..') || old.startsWith('/') || old.includes('\\')) throw new Error('Unsafe old site manifest path.');
      tree.push({ path: old, mode: '100644', type: 'blob', sha: null });
    }
  }
  const nextTree = api('POST', `repos/${repository}/git/trees`, { base_tree: commit.tree.sha, tree });
  if (nextTree.sha !== commit.tree.sha) {
    const next = api('POST', `repos/${repository}/git/commits`, { message: 'Update Playlista website', tree: nextTree.sha, parents: [ref.object.sha] });
    api('PATCH', `repos/${repository}/git/refs/heads/${encodeURIComponent(branch)}`, { sha: next.sha, force: false });
    console.log(`Website source published: ${next.sha}`);
  } else console.log('Website source is already current.');
  try {
    const pages = api('GET', `repos/${repository}/pages`);
    if (pages.source?.branch !== branch || pages.source?.path !== '/') throw new Error('Pages uses a different publishing source; review it before changing it.');
  } catch (error) {
    if (!isNotFound(error)) throw error;
    api('POST', `repos/${repository}/pages`, { build_type: 'legacy', source: { branch, path: '/' } });
  }
  api('POST', `repos/${repository}/pages/builds`);
  console.log('GitHub Pages build requested: https://playlista-app.github.io/');
}

if (require.main === module) publish({ dryRun: process.argv.includes('--dry-run') }).catch((error) => { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; });
module.exports = { siteFiles, publish };
