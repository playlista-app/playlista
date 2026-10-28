const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startPreview } = require('./preview-site');
const { launchBrowser, until } = require('./chrome');
const { repository } = require('../website/downloads');

async function check() {
  const preview = await startPreview();
  let browser;
  const errors = [];
  const release = { tag_name: 'v1.2.3', assets: ['windows-x64-setup.exe', 'windows-x64-portable.exe', 'mac-arm64.dmg', 'mac-x64.dmg', 'linux-x86_64.AppImage', 'linux-x64.tar.gz'].map((suffix) => {
    const name = `Playlista-1.2.3-${suffix}`;
    return { name, browser_download_url: `https://github.com/${repository}/releases/download/v1.2.3/${name}` };
  }) };
  let empty = false;
  let apiUnavailable = false;
  try {
    browser = await launchBrowser();
    browser.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
      if (message.method === 'Fetch.requestPaused') {
        const isApi = message.params.request.url.startsWith('https://api.github.com/');
        browser.send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: isApi && (empty || apiUnavailable) ? 404 : 200,
          responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(JSON.stringify(empty ? { tag_name: null, assets: [] } : release)).toString('base64') }).catch((error) => errors.push(error.message));
      }
    });
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.github.com/repos/*/releases/latest' }, { urlPattern: `${preview.url}/releases.json` }] });
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1050, deviceScaleFactor: 1, mobile: false });
    await browser.send('Network.setUserAgentOverride', { userAgent: 'PlaylistaWebsiteCheck Chrome', platform: 'Win32' });
    await browser.send('Page.navigate', { url: preview.url });
    await until(() => browser.evaluate('document.querySelector("#primaryDownload").href.endsWith("setup.exe") && document.querySelector("#appScreenshot").naturalWidth > 0'));
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(await browser.evaluate('document.querySelectorAll(".is-recommended").length'), 1);
    assert.equal(await browser.evaluate('document.querySelector("#primaryDownload").textContent.includes("for free")'), true);
    assert.equal(await browser.evaluate('document.querySelector(".nav-download").textContent.includes("for free")'), true);
    await fs.mkdir(path.join(__dirname, '../build/site'), { recursive: true });
    await fs.writeFile(path.join(__dirname, '../build/site/desktop.png'), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await browser.evaluate('document.querySelector("#tab-library").click()');
    await until(() => browser.evaluate('document.querySelector("#appScreenshot").src.endsWith("library.webp") && document.querySelector("#appScreenshot").complete'));
    assert.equal(await browser.evaluate('document.querySelector("#tab-library").getAttribute("aria-selected")'), 'true');
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await browser.evaluate('window.scrollTo(0,0)');
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'mobile layout must not overflow');
    await fs.writeFile(path.join(__dirname, '../build/site/mobile.png'), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true });
    assert.equal(await browser.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'free download label fits a narrow phone');
    for (const [platform, expected] of [['MacIntel', '#downloads'], ['Linux x86_64', '.AppImage']]) {
      await browser.send('Network.setUserAgentOverride', { userAgent: 'PlaylistaWebsiteCheck Chrome', platform });
      await browser.send('Page.reload');
      await until(() => browser.evaluate(`document.querySelector('#primaryDownload')?.href.endsWith(${JSON.stringify(expected)}) && document.querySelector('.is-recommended')?.dataset.platform === ${JSON.stringify(platform === 'MacIntel' ? 'mac' : 'linux')}`));
    }
    apiUnavailable = true;
    await browser.evaluate('sessionStorage.clear()');
    await browser.send('Page.reload');
    await until(() => browser.evaluate('document.querySelector("#primaryDownload")?.href.endsWith("linux-x86_64.AppImage")'));
    empty = true;
    await browser.evaluate('sessionStorage.clear()');
    await browser.send('Page.reload');
    await until(() => browser.evaluate('document.querySelector("#releaseStatus")?.textContent.includes("GitHub Releases")'));
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('a')].filter(link => link.href.includes('/releases/download/')).length`), 0);
    assert.equal(await browser.evaluate('document.querySelector("#primaryDownload").href.endsWith("/releases/latest")'), true);
    assert.deepEqual(errors, []);
    console.log('Website browser checks passed: previews, Windows/Linux downloads, Mac architecture choices, mobile layout, and unavailable releases.');
  } finally { if (browser) await browser.close(); await preview.close(); }
}
check().catch((error) => { console.error(error); process.exitCode = 1; });
