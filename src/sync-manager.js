const github = require('./github');
const appSettings = require('./app-settings');

function createSyncManager({ service = github, settings = appSettings, debounceMs = 1200, pollMs = 2500, remotePollMs = 60000 } = {}) {
  let timer = null;
  let debounce = null;
  let stopped = true;
  let polling = false;
  let activity = '';
  let error = '';
  let queue = Promise.resolve();
  let lastRemoteCheck = 0;
  let fingerprint = null;

  function enqueue(action, label) {
    const task = queue.catch(() => {}).then(async () => {
      activity = label;
      try {
        const result = await action();
        error = '';
        lastRemoteCheck = Date.now();
        return result;
      } catch (failure) {
        error = failure.message;
        lastRemoteCheck = Date.now();
        throw failure;
      } finally { activity = ''; }
    });
    queue = task;
    return task;
  }

  function cancelScheduledSync() {
    clearTimeout(debounce);
    debounce = null;
  }

  function sync(direction) {
    cancelScheduledSync();
    return enqueue(() => {
      if (direction === 'auto' && (stopped || settings.getRawSettings().github.autoSync !== true)) return { cancelled: true };
      return service.sync(direction);
    }, 'syncing');
  }

  function notifyLocalChange() {
    const config = settings.getRawSettings().github;
    if (stopped || config.autoSync !== true || !config.owner || !config.repository || !config.login) return;
    cancelScheduledSync();
    debounce = setTimeout(() => {
      debounce = null;
      if (!stopped && settings.getRawSettings().github.autoSync === true) sync('auto').catch(() => {});
    }, debounceMs);
    debounce.unref?.();
  }

  async function tick() {
    if (stopped || polling || activity) return;
    polling = true;
    try {
      const status = await service.getStatus();
      const changed = fingerprint !== status.localFingerprint;
      fingerprint = status.localFingerprint;
      if (!status.configured) return;
      if (status.autoSync) {
        if (changed || Date.now() - lastRemoteCheck >= remotePollMs) notifyLocalChange();
      } else if (Date.now() - lastRemoteCheck >= remotePollMs) {
        await enqueue(() => service.checkStatus(), 'checking');
      }
    } catch (failure) { error = failure.message; }
    finally { polling = false; }
  }

  function reconfigure() {
    cancelScheduledSync();
    lastRemoteCheck = 0;
    fingerprint = null;
    error = '';
    tick();
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      timer = setInterval(tick, pollMs);
      timer.unref?.();
      tick();
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      cancelScheduledSync();
    },
    reconfigure,
    notifyLocalChange,
    sync,
    testConnection: () => enqueue(() => service.testConnection(), 'checking'),
    resolveConflicts: (direction, paths) => enqueue(() => service.resolveConflicts(direction, paths), 'syncing'),
    async getStatus() { return { ...await service.getStatus(), activity, scheduled: Boolean(debounce), error }; },
  };
}

module.exports = { createSyncManager };
