const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function smoke() {
  const packaged = process.argv.includes('--packaged');
  const root = path.resolve(__dirname, '..');
  let executable;
  if (!packaged) executable = require('electron');
  else if (process.platform === 'win32') executable = path.join(root, 'dist/win-unpacked/Playlista.exe');
  else if (process.platform === 'linux') executable = path.join(root, 'dist/linux-unpacked/playlista');
  else {
    const folders = await fs.readdir(path.join(root, 'dist'));
    const folder = folders.find((name) => name === (process.arch === 'arm64' ? 'mac-arm64' : 'mac'));
    if (!folder) throw new Error('Build the macOS package first.');
    executable = path.join(root, 'dist', folder, 'Playlista.app/Contents/MacOS/Playlista');
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-desktop-smoke-'));
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('PLAYLISTA_') || key === 'ELECTRON_RUN_AS_NODE') delete env[key];
  env.PLAYLISTA_DESKTOP_DATA_DIR = directory;
  let child;
  try {
    child = spawn(executable, [...(!packaged ? [root] : []), '--smoke-test'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output = (output + chunk).slice(-5000); });
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`Desktop smoke test timed out. ${output}`)); }, 90000);
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('exit', (code) => { clearTimeout(timer); resolve(code); });
    });
    const report = JSON.parse(await fs.readFile(path.join(directory, 'smoke-result.json'), 'utf8').catch(() => { throw new Error(`Desktop exited with ${result}. ${output}`); }));
    assert.equal(result, 0, report.error || output);
    assert.equal(report.title, 'Playlista');
    assert.equal(report.origin, 'playlista://app');
    assert.equal(report.rendererHasNode, false);
    assert.equal(report.packaged, packaged);
    assert.equal(report.playlistDirectory, path.join(directory, 'playlists'));
    if (packaged) {
      assert.equal(report.youtube.available, true, report.youtube.error);
      assert.equal(report.spotify.available, true, report.spotify.error);
    }
    // Closing the desktop window must release its backend port.
    await assert.rejects(fetch(`http://127.0.0.1:${report.backendPort}/api/health`, { signal: AbortSignal.timeout(1500) }));
    console.log(`${packaged ? 'Packaged' : 'Development'} desktop smoke test passed (${process.platform}/${process.arch}).`);
  } finally {
    if (child && child.exitCode === null) child.kill();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('playlista-desktop-smoke-'));
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}

smoke().catch((error) => { console.error(error); process.exitCode = 1; });
