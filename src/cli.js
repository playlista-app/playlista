const path = require('node:path');
const { getPlaylistsDirectory, setPlaylistsDirectory, validateDirectory } = require('./store');
const appSettings = require('./app-settings');

async function main() {
  await appSettings.initialize({ getPlaylistsDirectory, setPlaylistsDirectory });
  const directory = path.resolve(process.argv[2] || getPlaylistsDirectory());
  let result;
  try {
    result = await validateDirectory(directory);
  } catch (error) {
    console.error(`Cannot read playlist directory ${directory}: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const playlistCount = result.records.length;
  const trackCount = result.records.reduce((total, record) => total + (record.playlist.songs?.length || 0), 0);
  if (result.issues.length) {
    for (const item of result.issues) {
      const location = item.line ? `${item.source}:${item.line}` : item.source;
      console.error(`${location}: error: ${item.message}`);
    }
    console.error(`\n${result.issues.length} error(s) in ${playlistCount} playlist file(s).`);
    process.exitCode = 1;
    return;
  }

  if (!playlistCount) {
    console.log(`No .lista files found in ${directory}.`);
  } else {
    console.log(`Valid: ${playlistCount} playlist file(s), ${trackCount} track query line(s).`);
  }
}

main();
