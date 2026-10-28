const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');

async function startPreview(port = 0) {
  const root = path.resolve(__dirname, '../website');
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.lista': 'text/plain' };
  const server = http.createServer(async (request, response) => {
    try {
      const source = new URL(request.url, 'http://localhost');
      const file = path.resolve(root, `.${decodeURIComponent(source.pathname === '/' ? '/index.html' : source.pathname)}`);
      if (!file.startsWith(root + path.sep)) { response.writeHead(403); response.end(); return; }
      const data = await fs.readFile(file);
      response.writeHead(200, { 'content-type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-store' });
      response.end(data);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

if (require.main === module) startPreview(Number(process.env.SITE_PORT) || 43818).then(({ url, close }) => {
  console.log(`Site preview: ${url}`);
  process.once('SIGINT', () => close()); process.once('SIGTERM', () => close());
}).catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { startPreview };
