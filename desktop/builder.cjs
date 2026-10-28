const path = require('node:path');
const fs = require('node:fs/promises');

module.exports = {
  appId: 'app.playlista.desktop',
  productName: 'Playlista',
  directories: { output: 'dist', buildResources: 'build/icons' },
  artifactName: 'Playlista-${version}-${os}-${arch}.${ext}',
  asar: true,
  files: ['desktop/main.js', 'desktop/protocol.js', 'desktop/credentials.js', 'src/**/*.js', 'public/**', 'package.json', 'build/icons/icon.png'],
  extraResources: [{ from: 'build/helpers', to: 'helpers' }],
  win: { target: ['nsis', 'portable'], icon: 'build/icons/icon.ico' },
  nsis: { artifactName: 'Playlista-${version}-windows-${arch}-setup.${ext}', oneClick: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
  portable: { artifactName: 'Playlista-${version}-windows-${arch}-portable.${ext}' },
  mac: { target: ['dmg', 'zip'], category: 'public.app-category.music', icon: 'build/icons/icon.icns', hardenedRuntime: true, notarize: Boolean(process.env.APPLE_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD) },
  linux: { target: ['AppImage', 'tar.gz'], category: 'AudioVideo', icon: 'build/icons/icon.png', executableName: 'playlista' },
  // Never package without the platform's native, tested integration helpers.
  async beforePack(context) {
    const manifest = JSON.parse(await fs.readFile(path.join(__dirname, '../build/helpers/manifest.json'), 'utf8'));
    const targetArch = require('builder-util').Arch[context.arch];
    if (manifest.platform !== context.electronPlatformName || manifest.arch !== targetArch) {
      throw new Error(`Helpers are ${manifest.platform}/${manifest.arch}; build native helpers for ${context.electronPlatformName}/${targetArch} first.`);
    }
  },
};
