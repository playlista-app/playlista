const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createProtocolHandler, isAppUrl, isExternalUrl } = require('../desktop/protocol');
const { createDesktopEncryption } = require('../desktop/credentials');
const { createCredentialStore } = require('../src/local-credentials');

test('desktop protocol forwards local API bodies while rejecting foreign origins and redirects', async () => {
  const requests = [];
  const handler = createProtocolHandler('http://127.0.0.1:12345', async (url, options) => {
    requests.push({ url: String(url), options });
    assert.equal(await new Response(options.body).text(), '{"name":"Punk"}');
    return new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } });
  });
  const response = await handler(new Request('playlista://app/api/playlists?test=1', { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'not-forwarded' }, body: '{"name":"Punk"}' }));
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(requests[0].url, 'http://127.0.0.1:12345/api/playlists?test=1');
  assert.equal(requests[0].options.headers.get('origin'), 'http://127.0.0.1:12345');
  assert.equal(requests[0].options.headers.has('cookie'), false);
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal((await handler(new Request('https://evil.example/api/playlists'))).status, 403);
  assert.equal((await handler(new Request('playlista://other/api/playlists'))).status, 403);
  assert.equal(requests.length, 1);
  assert.equal(isAppUrl('playlista://app/'), true);
  assert.equal(isExternalUrl('https://github.com/playlista-app/playlista'), true);
  for (const value of ['file:///etc/passwd', 'javascript:alert(1)', 'http://evil.example', 'https://user:pass@evil.example']) assert.equal(isExternalUrl(value), false);
});

test('desktop rejects Linux plaintext fallback and supports native secure stores', async () => {
  const storage = { getSelectedStorageBackend: () => 'basic_text', isEncryptionAvailable: () => true, isAsyncEncryptionAvailable: async () => true };
  assert.equal(await createDesktopEncryption(storage, 'linux').isAvailable(), false);
  storage.getSelectedStorageBackend = () => 'gnome_libsecret';
  assert.equal(await createDesktopEncryption(storage, 'linux').isAvailable(), true);
  assert.equal(await createDesktopEncryption(storage, 'darwin').isAvailable(), true);
  storage.isAsyncEncryptionAvailable = async () => false;
  assert.equal(await createDesktopEncryption(storage, 'win32').isAvailable(), false);
});

test('desktop connection ciphertext survives restart without storing credentials as plaintext', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-credentials-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('playlista-credentials-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, 'connection.json');
  const key = crypto.randomBytes(32);
  let available = true;
  const encryption = {
    isAvailable: async () => available,
    encrypt: async (text) => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const result = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), result]);
    },
    decrypt: async (value) => {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
  const options = { file, encryption, platform: 'darwin' };
  const store = createCredentialStore(options);
  const credentials = { auth: { cookie: 'synthetic-secret-cookie' }, account: { name: 'Personal account' } };
  await store.save(credentials, true);
  const text = await fs.readFile(file, 'utf8');
  assert.doesNotMatch(text, /cookie|Personal|synthetic-secret/);
  assert.equal(JSON.parse(text).version, 2);
  assert.deepEqual(await createCredentialStore(options).load(), credentials);
  available = false;
  await assert.rejects(store.save(credentials, true), /session-only/);
  await assert.rejects(store.load(), /unavailable/);
  await store.save(credentials, false);
  assert.equal(await store.load(), null);
});
