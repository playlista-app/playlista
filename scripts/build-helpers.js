const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pythonExecutable } = require('../src/python-bridge');
const { buildIcons } = require('./build-icons');

const root = path.resolve(__dirname, '..');
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} failed (${result.status}).`);
}

async function build() {
  const python = path.join(root, '.build-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) run(pythonExecutable(), ['-m', 'venv', path.join(root, '.build-venv')]);
  run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--timeout', '30', '--retries', '2',
    '-r', 'integrations/youtube/requirements.txt', '-r', 'integrations/spotify/requirements.txt', 'pyinstaller==6.22.3']);
  // Nothing under the developer's .venv, playlists or data folders is copied.
  run(python, ['scripts/freeze-helpers.py']);
  await buildIcons();
  fs.writeFileSync(path.join(root, 'build/helpers/manifest.json'), JSON.stringify({ platform: process.platform, arch: process.arch, version: require('../package.json').version }, null, 2));
  console.log(`Native integration helpers and icons ready for ${process.platform}/${process.arch}.`);
}

if (require.main === module) build().catch((error) => { console.error(error.message); process.exitCode = 1; });
