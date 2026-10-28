const test = require('node:test');
const assert = require('node:assert/strict');
const { nextVersion, release } = require('../scripts/release');

function fixture(overrides = {}) {
  const calls = [];
  const values = {
    'branch --show-current': 'main', 'status --porcelain': '', 'rev-parse --abbrev-ref @{upstream}': 'origin/main',
    'tag --list v0.1.1': '', 'rev-parse HEAD': 'abc123',
    'ls-remote --refs origin refs/heads/main refs/tags/v0.1.1': 'abc123\trefs/heads/main\n', ...overrides,
  };
  return { calls, options: { current: '0.1.0', requested: 'patch', npmPath: 'npm-cli.js', log: () => {}, run: (command, args, options) => {
    calls.push({ command, args, options });
    return values[args.join(' ')] || '';
  } } };
}

test('release versions must advance and dry run never mutates files or contacts the remote', () => {
  assert.equal(nextVersion('0.1.0', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.1.0', '1.0.0-beta.1'), '1.0.0-beta.1');
  for (const version of ['0.1.0', '0.0.1', 'garbage']) assert.throws(() => nextVersion('0.1.0', version));
  const f = fixture();
  assert.equal(release({ ...f.options, dryRun: true }).tag, 'v0.1.1');
  assert.deepEqual(f.calls.map(({ args }) => args), [['branch', '--show-current']]);
});

test('release refuses dirty, diverged, detached, and already-tagged states before any mutation', () => {
  for (const state of [
    { 'status --porcelain': ' M package.json' },
    { 'branch --show-current': '' },
    { 'rev-parse --abbrev-ref @{upstream}': 'other/main' },
    { 'tag --list v0.1.1': 'v0.1.1' },
    { 'ls-remote --refs origin refs/heads/main refs/tags/v0.1.1': 'new-head\trefs/heads/main\n' },
    { 'ls-remote --refs origin refs/heads/main refs/tags/v0.1.1': 'abc123\trefs/heads/main\ntag-hash\trefs/tags/v0.1.1' },
  ]) {
    const f = fixture(state);
    assert.throws(() => release(f.options));
    assert.equal(f.calls.some(({ options }) => options?.inherit), false);
  }
});

test('release commits only version manifests and atomically pushes a non-forced branch and tag', () => {
  const f = fixture();
  release(f.options);
  const mutations = f.calls.filter(({ options }) => options?.inherit);
  assert.deepEqual(mutations[0].args, ['npm-cli.js', 'version', '0.1.1', '--no-git-tag-version', '--ignore-scripts']);
  assert.deepEqual(mutations[1].args, ['add', '--', 'package.json', 'package-lock.json']);
  assert.deepEqual(mutations.at(-1).args, ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', 'refs/tags/v0.1.1']);
});
