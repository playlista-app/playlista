const fs = require('node:fs/promises');
const path = require('node:path');
const { prepareSiteFiles } = require('./publish-site');

async function buildSite() {
  const files = await prepareSiteFiles();
  const buildRoot = path.resolve(__dirname, '../build');
  const output = path.resolve(buildRoot, 'website');
  if (path.dirname(output) !== buildRoot || path.basename(output) !== 'website') throw new Error('Unsafe site output directory.');
  // Only this generated build directory is replaced; website/ is never removed.
  await fs.rm(output, { recursive: true, force: true });
  for (const file of files) {
    const destination = path.resolve(output, file.path);
    if (!destination.startsWith(output + path.sep)) throw new Error('Unsafe site output path.');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.content);
  }
  console.log(`Prepared ${files.length} public website files in ${output}.`);
}

if (require.main === module) buildSite().catch((error) => { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; });
module.exports = { buildSite };
