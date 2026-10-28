const { execFileSync } = require('node:child_process');
const path = require('node:path');
const semver = require('semver');

function nextVersion(current, requested) {
  const next = ['patch', 'minor', 'major'].includes(requested) ? semver.inc(current, requested) : semver.valid(requested);
  if (!next || !semver.gt(next, current)) throw new Error('Choose patch, minor, major, or a version greater than the current version.');
  return next;
}

function release({ current, requested, dryRun = false, run, log = console.log, npmPath = process.env.npm_execpath }) {
  const version = nextVersion(current, requested);
  const tag = `v${version}`;
  const branch = run('git', ['branch', '--show-current']).trim();
  if (!branch) throw new Error('Check out a branch before creating a release.');
  const commands = [
    [process.execPath, [npmPath || '<npm-cli.js>', 'version', version, '--no-git-tag-version', '--ignore-scripts']],
    ['git', ['add', '--', 'package.json', 'package-lock.json']],
    ['git', ['commit', '-m', `Release ${tag}`]],
    ['git', ['tag', '-a', tag, '-m', `Playlista ${version}`]],
    ['git', ['push', '--atomic', 'origin', `HEAD:refs/heads/${branch}`, `refs/tags/${tag}`]],
  ];
  log(`Release ${current} → ${version} from ${branch}. GitHub Actions will build a draft release.`);
  if (dryRun) {
    for (const [index, [command, args]] of commands.entries()) log(index === 0
      ? `npm version ${version} --no-git-tag-version --ignore-scripts`
      : [command, ...args.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg)].join(' '));
    log('Dry run: no files, commits, tags, or remote state changed. Actual release requires a clean, pushed branch tracking origin.');
    return { version, tag };
  }
  if (!npmPath) throw new Error('Run this through npm run release.');
  if (run('git', ['status', '--porcelain']).trim()) throw new Error('Commit or stash your changes first. Personal playlists and build outputs remain ignored.');
  if (run('git', ['rev-parse', '--abbrev-ref', '@{upstream}']).trim() !== `origin/${branch}`) throw new Error('The current branch must track the same branch on origin.');
  if (run('git', ['tag', '--list', tag]).trim()) throw new Error(`${tag} already exists locally.`);
  const head = run('git', ['rev-parse', 'HEAD']).trim();
  const refs = run('git', ['ls-remote', '--refs', 'origin', `refs/heads/${branch}`, `refs/tags/${tag}`]);
  const remote = new Map(refs.trim().split('\n').filter(Boolean).map((line) => { const [hash, ref] = line.split(/\s+/); return [ref, hash]; }));
  if (remote.has(`refs/tags/${tag}`)) throw new Error(`${tag} already exists on origin.`);
  if (remote.get(`refs/heads/${branch}`) !== head) throw new Error('Push/pull your branch so it matches origin before releasing.');
  // A non-force atomic push sends the release commit and tag together.
  for (const [command, args] of commands) run(command, args, { inherit: true });
  log(`${tag} pushed. Review the draft under GitHub → Releases after all builds pass.`);
  return { version, tag };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const requested = args.find((arg) => !arg.startsWith('-'));
  if (!requested || args.includes('--help')) console.log('Usage: npm run release -- patch|minor|major|0.2.0 [--dry-run]');
  else {
    try {
      if (args.some((arg) => arg.startsWith('-') && arg !== '--dry-run')) throw new Error('Unknown release option. Use --dry-run to preview.');
      release({ current: require('../package.json').version, requested, dryRun: args.includes('--dry-run'), run: (command, params, options = {}) =>
        execFileSync(command, params, { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true, stdio: options.inherit ? 'inherit' : 'pipe' }) || '' });
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}

module.exports = { nextVersion, release };
