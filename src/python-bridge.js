const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { StoreError } = require('./store');

const root = path.resolve(__dirname, '..');

function pythonExecutable() {
  if (process.env.PLAYLISTA_PYTHON) return process.env.PLAYLISTA_PYTHON;
  const local = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return fs.existsSync(local) ? local : process.platform === 'win32' ? 'python' : 'python3';
}

function createPythonBridge({ provider, script, setupCommand }) {
  return function runBridge(input, { timeout = 90_000, signal, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new StoreError(`${provider} operation cancelled.`, 409)); return; }
      const child = spawn(pythonExecutable(), ['-I', script], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      let settled = false;
      const stop = () => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
        if (process.platform === 'win32') {
          // Windows' virtualenv launcher can have a Python child of its own.
          // Stop this helper's tree so cancellation cannot orphan that interpreter.
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
        } else child.kill();
      };
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => {
        stop();
        finish(new StoreError(`${provider} timed out. If exporting, check your ${provider} library before retrying.`, 504));
      }, timeout);
      const abort = () => {
        stop();
        finish(new StoreError(`${provider} operation cancelled.`, 409));
      };
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => finish(new StoreError(`Python 3.10+ is needed for ${provider}. Install Python and run npm run ${setupCommand}.`, 503)));
      child.stdout.on('data', (chunk) => {
        output += chunk.toString('utf8');
        let newline;
        while ((newline = output.indexOf('\n')) !== -1) {
          const line = output.slice(0, newline);
          output = output.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (event.progress) onProgress?.(event.progress);
          } catch {
            stop();
            finish(new StoreError(`${provider} returned invalid progress data.`, 502));
            return;
          }
        }
        if (Buffer.byteLength(output) > 12 * 1024 * 1024) {
          stop();
          finish(new StoreError(`The ${provider} response was too large.`, 413));
        }
      });
      child.stderr.resume(); // Never echo third party diagnostics or secrets.
      child.stdin.on('error', () => {});
      child.on('close', (code) => {
        if (settled) return;
        try {
          const data = JSON.parse(output);
          if (code !== 0 || !data.ok) throw new StoreError(data.error || `${provider} helper failed.`, 400);
          finish(null, data.result);
        } catch (error) {
          finish(error instanceof StoreError ? error : new StoreError(`${provider} helper failed. Check Python 3.10+ and run npm run ${setupCommand}.`, 503));
        }
      });
      child.stdin.end(JSON.stringify(input));
    });
  };

}

module.exports = { createPythonBridge, pythonExecutable };
