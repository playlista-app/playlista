const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { gh, api } = require('./github-api');

const app = 'playlista-app/playlista';
const site = 'playlista-app/playlista-app.github.io';
const secretName = 'WEBSITE_DEPLOY_KEY';
const keyTitle = 'Playlista website automation';

async function setup({ dryRun = false } = {}) {
  if (dryRun) { console.log(`Would add a write deploy key to ${site} and store it as ${secretName} in ${app}. No credentials or repository settings changed.`); return; }
  const marker = api('GET', `repos/${site}/contents/.playlista-site.json`);
  if (JSON.parse(Buffer.from(marker.content, 'base64').toString('utf8')).generator !== 'playlista/website') throw new Error('The target repository is not the managed Playlista website.');
  const keys = api('GET', `repos/${site}/keys`).filter((key) => key.title === keyTitle);
  const secrets = api('GET', `repos/${app}/actions/secrets`);
  const hasSecret = secrets.secrets.some((secret) => secret.name === secretName);
  if (hasSecret && keys.some((key) => !key.read_only)) { console.log('Website deployment key is already configured.'); return; }
  if (hasSecret) throw new Error('An existing WEBSITE_DEPLOY_KEY has no matching managed deploy key; review it before replacing it.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-site-key-'));
  let added;
  try {
    const keyPath = path.join(directory, 'deploy');
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'playlista-website-deploy', '-f', keyPath], { stdio: 'ignore', windowsHide: true });
    const publicKey = (await fs.readFile(`${keyPath}.pub`, 'utf8')).trim();
    added = api('POST', `repos/${site}/keys`, { title: keyTitle, key: publicKey, read_only: false });
    try { gh(['secret', 'set', secretName, '--repo', app], { input: await fs.readFile(keyPath) }); }
    catch (error) { gh(['api', '--method', 'DELETE', `repos/${site}/keys/${added.id}`]); throw error; }
    for (const key of keys) gh(['api', '--method', 'DELETE', `repos/${site}/keys/${key.id}`]);
    console.log(`Configured a deployment key limited to ${site}; its private key is stored only as the ${secretName} Actions secret.`);
  } finally {
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('playlista-site-key-')) throw new Error('Unsafe deploy-key cleanup.');
    await fs.rm(directory, { recursive: true, force: true });
  }
}

if (require.main === module) setup({ dryRun: process.argv.includes('--dry-run') }).catch((error) => {
  let detail;
  try { detail = JSON.parse(error.stdout?.toString()); } catch {}
  console.error(detail?.message || error.stderr?.toString() || error.message);
  for (const item of detail?.errors || []) console.error(typeof item === 'string' ? item : `${item.field || 'request'}: ${item.message || item.code}`);
  process.exitCode = 1;
});
module.exports = { setup };
