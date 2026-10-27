const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { pythonExecutable } = require('../src/youtube-bridge');

const root = path.resolve(__dirname, '..');
function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) {
    console.error('YouTube Music setup failed. Install Python 3.10+ or set PLAYLISTA_PYTHON to its executable.');
    process.exit(1);
  }
}
const python = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
if (!fs.existsSync(python)) run(pythonExecutable(), ['-m', 'venv', path.join(root, '.venv')]);
run(python, ['-m', 'pip', '--disable-pip-version-check', 'install', '--timeout', '15', '--retries', '2', '-r', path.join(root, 'integrations/youtube/requirements.txt')]);
console.log('YouTube Music is ready. Open Settings to connect your account.');
