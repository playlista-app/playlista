const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { serializePlaylist, serializeTrack } = require('../src/format');
const { launchBrowser, until } = require('./chrome');

async function capture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'playlista-site-demo-'));
  const env = { PLAYLISTA_PLAYLISTS_DIR: path.join(directory, 'playlists'), PLAYLISTA_SETTINGS_FILE: path.join(directory, 'settings.json'), PLAYLISTA_TAG_METADATA_FILE: path.join(directory, 'tags.json') };
  Object.assign(process.env, env);
  let running;
  let browser;
  try {
    await fs.mkdir(env.PLAYLISTA_PLAYLISTS_DIR);
    const playlists = [
      { file: 'punk', name: 'Punk', description: 'Turn it up. All the good stuff, together.', tags: ['nostalgia'], songs: [] },
      { file: '90s-punk', name: '90s Punk', parent: 'Punk', tags: ['nostalgia'], songs: [['Green Day', 'Basket Case'], ['The Offspring', 'The Kids Aren’t Alright'], ['Rancid', 'Ruby Soho'], ['NOFX', 'Linoleum']] },
      { file: 'skatepark-anthems', name: 'Skatepark Anthems', parent: 'Punk', description: 'The long way home. Windows down, volume up.', tags: ['nostalgia', 'skate'], songs: [
        ['Sum 41', 'In Too Deep', ['hype']], ['blink-182', 'All The Small Things', ['singalong']], ['Green Day', 'American Idiot', ['hype']], ['Jimmy Eat World', 'The Middle', ['singalong']], ['Reel Big Fish', 'Sell Out', ['skate']], ['New Found Glory', 'My Friends Over You'], ['Good Charlotte', 'The Anthem', ['hype']], ['Yellowcard', 'Ocean Avenue'], ['Less Than Jake', 'All My Best Friends Are Metalheads'], ['The Offspring', 'Want You Bad'],
      ] },
      { file: 'night-drive', name: 'Night Drive', description: 'One more song before the turnoff.', tags: ['late night'], songs: [['M83', 'Midnight City'], ['Kavinsky', 'Nightcall'], ['The Midnight', 'Days of Thunder']] },
    ];
    for (const item of playlists) await fs.writeFile(path.join(env.PLAYLISTA_PLAYLISTS_DIR, `${item.file}.lista`),
      serializePlaylist({ ...item, created: '2026-10-20T10:00:00.000Z', updated: '2026-10-27T10:00:00.000Z' })
      + item.songs.map(([artist, title, tags = []]) => serializeTrack({ artist, title, tags }) + '\n').join(''));
    const music = { status: async () => ({ connected: true, account: { name: 'Sample account' }, remembered: false, canRemember: false, runtime: { available: true } }), close() {} };
    running = await require('../src/server').startServer({ port: 0, youtube: music, spotify: music });
    browser = await launchBrowser();
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1340, height: 900, deviceScaleFactor: 1, mobile: false });
    await browser.send('Page.navigate', { url: `http://127.0.0.1:${running.address.port}` });
    await until(() => browser.evaluate('typeof goToPlaylist === "function" && Boolean(document.querySelector("#playlistTree .tree-button"))'));
    await browser.evaluate('goToPlaylist("skatepark-anthems.lista")');
    await until(() => browser.evaluate('document.querySelector("#playlistName").textContent === "Skatepark Anthems" && document.querySelector("#songCount").textContent === "10"'));
    await browser.evaluate('document.activeElement.blur(); window.scrollTo(0,0)');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const output = path.join(__dirname, '../website/assets');
    await fs.writeFile(path.join(output, 'playlist.webp'), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'webp', quality: 88 })).data, 'base64'));
    await browser.evaluate('goHome(); window.scrollTo(0,0)');
    await until(() => browser.evaluate('!document.querySelector("#homeView").hidden'));
    await fs.writeFile(path.join(output, 'library.webp'), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'webp', quality: 88 })).data, 'base64'));
    console.log('Captured both app previews using a generated sample library. Personal playlists and connections were not read.');
  } finally {
    if (browser) await browser.close();
    if (running) await running.close();
    if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('playlista-site-demo-')) throw new Error('Unsafe demo cleanup.');
    await fs.rm(directory, { recursive: true, force: true });
  }
}
capture().catch((error) => { console.error(error); process.exitCode = 1; });
