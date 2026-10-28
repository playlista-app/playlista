const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { StoreError } = require('./store');

function createCredentialStore({ file, bridge, platform = process.platform, encryption }) {
  const canRemember = async () => encryption ? encryption.isAvailable() : platform === 'win32';
  return {
    canRemember,
    async load() {
      let saved;
      try { saved = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
      if (typeof saved.ciphertext !== 'string') throw new Error('Unsupported saved connection.');
      if (saved.version === 2 && encryption) {
        if (!await canRemember()) throw new Error('The system credential store is unavailable.');
        return JSON.parse(await encryption.decrypt(Buffer.from(saved.ciphertext, 'base64')));
      }
      if (saved.version === 1 && platform === 'win32') return bridge({ action: 'unseal', value: saved.ciphertext });
      throw new Error('Unsupported saved connection.');
    },
    async save(value, remember) {
      if (!remember) { await fs.rm(file, { force: true }); return; }
      if (!await canRemember()) throw new StoreError('The system credential store is unavailable. Use a session-only connection.');
      const ciphertext = encryption
        ? (await encryption.encrypt(JSON.stringify(value))).toString('base64')
        : await bridge({ action: 'seal', value });
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: encryption ? 2 : 1, ciphertext }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, file);
      } finally { await fs.rm(temporary, { force: true }); }
    },
    async clear() { await fs.rm(file, { force: true }); },
  };
}

module.exports = { createCredentialStore };
