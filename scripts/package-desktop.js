const { spawnSync } = require('node:child_process');
const path = require('node:path');

function packagingEnvironment(source = process.env) {
  const env = { ...source };
  // Actions expands missing secrets to "". electron-builder's macOS signer
  // interprets CSC_LINK="" as the checkout directory rather than no certificate.
  for (const key of ['CSC_LINK', 'WIN_CSC_LINK', 'CSC_INSTALLER_LINK', 'APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_SPECIFIC_PASSWORD']) {
    if (!env[key]?.trim()) delete env[key];
  }
  return env;
}

if (require.main === module) {
  const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), '--config', path.join(__dirname, '../desktop/builder.cjs'), ...process.argv.slice(2), '--publish', 'never'], {
    cwd: path.resolve(__dirname, '..'), env: packagingEnvironment(), stdio: 'inherit', windowsHide: true,
  });
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status ?? 1;
}

module.exports = { packagingEnvironment };
