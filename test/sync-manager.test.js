const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { createSyncManager } = require('../src/sync-manager');

function setup(autoSync) {
  const config = { autoSync, owner: 'personal', repository: 'music', login: 'personal' };
  const calls = [];
  let active = 0;
  let maxActive = 0;
  let fail = false;
  const service = {
    async getStatus() { return { configured: true, autoSync: config.autoSync, localFingerprint: 'library', files: [] }; },
    async checkStatus() { calls.push('check'); },
    async sync(direction) {
      active += 1;
      maxActive = Math.max(active, maxActive);
      calls.push(direction);
      await delay(10);
      active -= 1;
      if (fail) throw new Error('Network unavailable');
      return { conflicts: [] };
    },
  };
  const manager = createSyncManager({ service, settings: { getRawSettings: () => ({ github: config }) }, debounceMs: 15, pollMs: 10000 });
  return { manager, calls, maxActive: () => maxActive, fail: () => { fail = true; } };
}

test('automatic uploads require opt-in; manual mode checks the remote without saving', async () => {
  const app = setup(false);
  app.manager.start();
  app.manager.notifyLocalChange();
  await delay(60);
  app.manager.stop();
  assert.deepEqual(app.calls, ['check']);
});

test('automatic saves debounce a burst of edits and stop cancels scheduled work', async () => {
  const app = setup(true);
  app.manager.start();
  await delay(60);
  assert.deepEqual(app.calls, ['auto']);
  app.manager.notifyLocalChange();
  app.manager.notifyLocalChange();
  app.manager.notifyLocalChange();
  await delay(60);
  assert.deepEqual(app.calls, ['auto', 'auto']);
  app.manager.notifyLocalChange();
  app.manager.stop();
  await delay(40);
  assert.deepEqual(app.calls, ['auto', 'auto']);
});

test('sync operations cannot write concurrently', async () => {
  const app = setup(false);
  await Promise.all([app.manager.sync('push'), app.manager.sync('pull'), app.manager.sync('push')]);
  assert.equal(app.maxActive(), 1);
  assert.deepEqual(app.calls, ['push', 'pull', 'push']);
});

test('background failures remain visible in status without an unhandled rejection', async () => {
  const app = setup(true);
  app.fail();
  app.manager.start();
  await delay(60);
  app.manager.stop();
  assert.equal((await app.manager.getStatus()).error, 'Network unavailable');
});

test('turning off automatic sync cancels a save already waiting behind another operation', async () => {
  const config = { autoSync: true, owner: 'personal', repository: 'music', login: 'personal' };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const calls = [];
  const manager = createSyncManager({
    settings: { getRawSettings: () => ({ github: config }) },
    service: {
      async getStatus() { return { configured: true, autoSync: config.autoSync, localFingerprint: 'library' }; },
      async sync(direction) { calls.push(direction); await gate; },
    },
    debounceMs: 10000,
  });
  manager.start();
  const manual = manager.sync('push');
  const automatic = manager.sync('auto');
  config.autoSync = false;
  release();
  await manual;
  assert.equal((await automatic).cancelled, true);
  manager.stop();
  assert.deepEqual(calls, ['push']);
});
