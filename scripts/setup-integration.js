const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { pythonExecutable } = require('../src/python-bridge');

const integration = process.argv[2];
const label = { youtube: 'YouTube Music', spotify: 'Spotify' }[integration];
if (!label) { console.error('Choose youtube or spotify.'); process.exit(1); }

const root = path.resolve(__dirname, '..');
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    console.error(`${label} setup failed. Install Python 3.10+ or set PLAYLISTA_PYTHON to its executable.`);
    process.exit(1);
  }
}
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(python)) run(pythonExecutable(), ['-m', 'venv', path.join(root, '.venv')]);
run(python, ['-m', 'pip', '--disable-pip-version-check', 'install', '--timeout', '15', '--retries', '2', '-r', path.join(root, 'integrations', integration, 'requirements.txt')]);
console.log(`${label} is ready. Open Settings to connect your account.`);
