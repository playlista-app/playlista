const fs = require('node:fs/promises');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

async function buildIcons() {
  const output = path.join(__dirname, '../build/icons');
  await fs.mkdir(output, { recursive: true });
  const svg = await fs.readFile(path.join(__dirname, '../public/favicon.svg'), 'utf8');
  const png = (size) => Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
  await fs.writeFile(path.join(output, 'icon.png'), png(512));
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = sizes.map(png);
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  await fs.writeFile(path.join(output, 'icon.ico'), Buffer.concat([header, ...images]));
  const chunks = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]].map(([type, size]) => {
    const data = png(size);
    const entry = Buffer.alloc(8);
    entry.write(type);
    entry.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([entry, data]);
  });
  const icns = Buffer.alloc(8);
  icns.write('icns');
  icns.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  await fs.writeFile(path.join(output, 'icon.icns'), Buffer.concat([icns, ...chunks]));
}

if (require.main === module) buildIcons().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { buildIcons };
