const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { StoreError } = require('./store');

function createCredentialStore({ file, bridge, platform = process.platform }) {
  return {
    async load() {
      let saved;
      try { saved = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (saved.version !== 1 || platform !== 'win32' || typeof saved.ciphertext !== 'string') throw new Error('Unsupported saved connection.');
      return bridge({ action: 'unseal', value: saved.ciphertext });
    },
    async save(value, remember) {
      if (!remember) { await fs.rm(file, { force: true }); return; }
      if (platform !== 'win32') throw new StoreError('Use a session-only connection on this operating system.');
      const ciphertext = await bridge({ action: 'seal', value });
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: 1, ciphertext }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }); }
    },
    async clear() { await fs.rm(file, { force: true }); },
  };
}

module.exports = { createCredentialStore };
