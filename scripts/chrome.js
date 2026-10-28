const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');

async function until(action, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await action(); if (result) return result; await delay(40); }
  throw new Error('Browser check timed out.');
}

async function launchBrowser() {
  const executable = process.env.PLAYLISTA_BROWSER_EXE || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find(existsSync);
  if (!executable) throw new Error('Set PLAYLISTA_BROWSER_EXE to a Chromium browser.');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-site-browser-'));
  const child = spawn(executable, ['--headless=new', '--disable-gpu', '--in-process-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let socket;
  const pending = new Map();
  const listeners = [];
  let nextId = 0;
  const close = async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ id: ++nextId, method: 'Browser.close' }));
      await until(() => child.exitCode !== null || child.signalCode !== null, 3000).catch(() => {});
      socket.close();
    }
    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      else child.kill('SIGKILL');
    }
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Browser closed.')); }
    pending.clear();
    if (path.dirname(profile) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('playlista-site-browser-')) throw new Error('Unsafe browser profile cleanup.');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  };
  try {
    let launchError;
    child.on('error', (error) => { launchError = error; });
    const port = await until(async () => {
      if (launchError) throw launchError;
      return fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').then((data) => Number(data.split('\n')[0])).catch(() => null);
    });
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      for (const listener of listeners) listener(message);
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 10000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await send('Runtime.enable');
    return { send, evaluate, until, close, on: (listener) => listeners.push(listener) };
  } catch (error) { await close(); throw error; }
}

module.exports = { launchBrowser, until };
