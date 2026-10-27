const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomInt, createHash } = require('node:crypto');
const { parsePlaylistText, validateCollection, serializePlaylist, serializeTrack, serializeTagList, serializeHeaderValue } = require('./format');

const ROOT = path.resolve(__dirname, '..');
let playlistsDirectory = path.resolve(process.env.PLAYLISTA_PLAYLISTS_DIR || path.join(ROOT, 'playlists'));
const TAG_METADATA_FILE = path.resolve(process.env.PLAYLISTA_TAG_METADATA_FILE || path.join(ROOT, 'data', 'tag-metadata.json'));
const TAG_COLORS = ['#dff0e3', '#fce4d5', '#e7e2f4', '#dcecf5', '#f6e8bd', '#f4dfe8', '#dcefe9', '#ece6d9', '#e1e7f7', '#f4e3ce', '#dce9d5', '#f3e0df'];
let tagMetadataQueue = Promise.resolve();
let playlistWriteQueue = Promise.resolve();

function serializeAccess(operation) {
  return (...args) => {
    const result = playlistWriteQueue.catch(() => {}).then(() => operation(...args));
    playlistWriteQueue = result;
    return result;
  };
}

class StoreError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'StoreError';
    this.statusCode = statusCode;
  }
}

async function findListaFiles(directory, base = directory) {
  const found = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== '.git') {
      found.push(...await findListaFiles(absolute, base));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.lista')) {
      found.push({
        absolute,
        relative: path.relative(base, absolute).split(path.sep).join('/'),
      });
    }
  }
  return found;
}

async function loadRecords(directory = playlistsDirectory, create = false) {
  if (create) await fs.mkdir(directory, { recursive: true });
  const files = await findListaFiles(directory);
  const records = [];
  for (const file of files) {
    let text;
    try {
      text = await fs.readFile(file.absolute, 'utf8');
    } catch (error) {
      records.push({
        file: file.relative,
        absolute: file.absolute,
        text: '',
        playlist: { source: file.relative, songs: [] },
        issues: [{ source: file.relative, line: null, severity: 'error', message: `cannot read file: ${error.message}` }],
      });
      continue;
    }
    const parsed = parsePlaylistText(text, file.relative);
    records.push({ ...parsed, file: file.relative, absolute: file.absolute, text });
  }
  return records;
}

function publicPlaylist(record, allIssues) {
  const localIssues = allIssues.filter((item) => item.source === record.file);
  return {
    id: record.file,
    file: record.file,
    name: record.playlist.name,
    parent: record.playlist.parent,
    description: record.playlist.description,
    tags: record.playlist.tags || [],
    created: record.playlist.created,
    updated: record.playlist.updated,
    songs: record.playlist.songs || [],
    valid: localIssues.length === 0,
  };
}

async function getLibrary(directory = playlistsDirectory) {
  const records = await loadRecords(directory, true);
  const issues = validateCollection(records);
  return {
    revision: collectionFingerprint(records),
    playlists: records.map((record) => publicPlaylist(record, issues)),
    issues,
    valid: issues.length === 0,
  };
}

function collectionFingerprint(records) {
  const hash = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  return hash(JSON.stringify(records.map((record) => [record.file, hash(record.text)]).sort(([a], [b]) => a.localeCompare(b))));
}

async function validateDirectory(directory = playlistsDirectory) {
  const records = await loadRecords(directory);
  return { records, issues: validateCollection(records) };
}

function cleanText(value, field, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return '';
    throw new StoreError(`${field} is required`);
  }
  if (typeof value !== 'string') throw new StoreError(`${field} must be text`);
  const text = value.trim();
  if (!text && optional) return '';
  if (!text) throw new StoreError(`${field} is required`);
  if (/[\r\n]/.test(text)) throw new StoreError(`${field} must fit on one line`);
  if (text.length > 1000) throw new StoreError(`${field} must be 1000 characters or fewer`);
  return text;
}

function cleanTags(value) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) throw new StoreError('tags must be a list');
  const tags = value.map((tag) => cleanText(tag, 'tag'));
  const normalized = tags.map((tag) => tag.toLocaleLowerCase('en-US'));
  if (new Set(normalized).size !== normalized.length) throw new StoreError('tags must be unique');
  return tags;
}

function tagKey(value) {
  return value.toLocaleLowerCase('en-US');
}

function sortedTagMetadata(entries) {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

function queueTagMetadata(task) {
  const result = tagMetadataQueue.then(task);
  tagMetadataQueue = result.catch(() => {});
  return result;
}

function chooseTagColor(entries) {
  const used = new Set(entries.map((entry) => entry.color.toLowerCase()));
  const unused = TAG_COLORS.filter((color) => !used.has(color.toLowerCase()));
  return unused.length ? unused[randomInt(unused.length)] : TAG_COLORS[randomInt(TAG_COLORS.length)];
}

async function readTagMetadataFile() {
  let contents;
  try {
    contents = await fs.readFile(TAG_METADATA_FILE, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new StoreError(`Tag metadata is not valid JSON: ${error.message}`, 500);
  }
  if (parsed?.version !== 1 || !Array.isArray(parsed.tags)) {
    throw new StoreError('Tag metadata must have version 1 and a tags list.', 500);
  }
  const entries = [];
  for (const entry of parsed.tags) {
    if (typeof entry?.name !== 'string' || typeof entry?.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(entry.color)) {
      throw new StoreError('Tag metadata contains an invalid tag or color.', 500);
    }
    const name = entry.name.trim();
    if (!name) throw new StoreError('Tag metadata contains an empty tag name.', 500);
    if (!entries.some((item) => tagKey(item.name) === tagKey(name))) entries.push({ name, color: entry.color.toLowerCase() });
  }
  return entries;
}

async function writeTagMetadataFile(entries) {
  const content = `${JSON.stringify({ version: 1, tags: sortedTagMetadata(entries) }, null, 2)}\n`;
  await writeAtomically(TAG_METADATA_FILE, content);
}

async function ensureTagMetadata() {
  const records = await loadRecords(playlistsDirectory, true);
  const entries = await readTagMetadataFile();
  const names = [];
  for (const record of records) {
    names.push(...(record.playlist.tags || []));
    for (const song of record.playlist.songs || []) names.push(...song.tags);
  }
  let changed = false;
  for (const name of names) {
    if (entries.some((entry) => tagKey(entry.name) === tagKey(name))) continue;
    entries.push({ name, color: chooseTagColor(entries) });
    changed = true;
  }
  let exists = true;
  try {
    await fs.stat(TAG_METADATA_FILE);
  } catch (error) {
    if (error.code === 'ENOENT') exists = false;
    else throw error;
  }
  if (changed || !exists) await writeTagMetadataFile(entries);
  return sortedTagMetadata(entries);
}

async function getTagMetadata() {
  return queueTagMetadata(ensureTagMetadata);
}

async function registerTagNames(value) {
  const names = cleanTags(value);
  if (!names.length) return getTagMetadata();
  return queueTagMetadata(async () => {
    const entries = await ensureTagMetadata();
    for (const name of names) {
      if (entries.some((entry) => tagKey(entry.name) === tagKey(name))) continue;
      entries.push({ name, color: chooseTagColor(entries) });
    }
    await writeTagMetadataFile(entries);
    return sortedTagMetadata(entries);
  });
}

function filenameFor(name, suffix = 1) {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'playlist';
  return `${base}${suffix > 1 ? `-${suffix}` : ''}.lista`;
}

function assertWritable(records, issues) {
  if (issues.length) {
    throw new StoreError('Fix the playlist validation errors before saving new data.', 409);
  }
  return records;
}

async function createPlaylist(input) {
  const records = await loadRecords(playlistsDirectory, true);
  const issues = validateCollection(records);
  assertWritable(records, issues);

  const name = cleanText(input.name, 'playlist name');
  const parentName = cleanText(input.parent, 'parent playlist', { optional: true });
  const description = cleanText(input.description, 'description', { optional: true });
  const tags = cleanTags(input.tags);
  const nameKey = name.toLocaleLowerCase('en-US');
  if (records.some((record) => record.playlist.name?.toLocaleLowerCase('en-US') === nameKey)) {
    throw new StoreError(`A playlist named "${name}" already exists.`, 409);
  }
  if (parentName && !records.some((record) => record.playlist.name?.toLocaleLowerCase('en-US') === parentName.toLocaleLowerCase('en-US'))) {
    throw new StoreError(`Parent playlist "${parentName}" was not found.`, 400);
  }

  const now = new Date().toISOString();
  const content = serializePlaylist({ name, parent: parentName, description, tags, created: now, updated: now });
  const candidate = parsePlaylistText(content, '<new playlist>');
  const candidateIssues = validateCollection([...records, candidate]);
  if (candidateIssues.length) throw new StoreError(candidateIssues[0].message, 400);

  await registerTagNames(tags);
  await fs.mkdir(playlistsDirectory, { recursive: true });
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const file = filenameFor(name, suffix);
    const absolute = path.join(playlistsDirectory, file);
    try {
      await fs.writeFile(absolute, content, { encoding: 'utf8', flag: 'wx' });
      return { id: file, file };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new StoreError('Could not choose an unused playlist filename.', 409);
}

async function setPlaylistParent(input) {
  const records = await loadRecords(playlistsDirectory, true);
  assertWritable(records, validateCollection(records));
  const target = records.find((record) => record.file === input.file);
  if (!target) throw new StoreError('Playlist was not found. Refresh and try again.', 404);
  const parentName = cleanText(input.parent, 'parent playlist', { optional: true });
  if (parentName && !records.some((record) => tagKey(record.playlist.name) === tagKey(parentName))) {
    throw new StoreError(`Parent playlist "${parentName}" was not found.`, 404);
  }

  const lines = target.text.split(/\r?\n/);
  const parentIndex = lines.findIndex((line) => /^parent\s*:/i.test(line.trim()));
  if (parentName) {
    const parentLine = `parent: ${serializeHeaderValue(parentName)}`;
    if (parentIndex >= 0) lines[parentIndex] = parentLine;
    else {
      const playlistIndex = lines.findIndex((line) => /^playlist\s*:/i.test(line.trim()));
      lines.splice(playlistIndex + 1, 0, parentLine);
    }
  } else if (parentIndex >= 0) {
    lines.splice(parentIndex, 1);
  }
  refreshUpdatedTimestamp(lines);
  const text = `${lines.join('\n')}${target.text.endsWith('\n') ? '\n' : ''}`;
  validateChangedPlaylist(records, target, text);
  await writeAtomically(target.absolute, text);
  return { file: target.file };
}

function setPlaylistHeader(lines, key, value) {
  const separator = lines.findIndex((line) => line.trim() === '---');
  if (separator < 0) throw new StoreError('Playlist header separator is missing.', 409);
  const matcher = new RegExp(`^${key}\\s*:`, 'i');
  const index = lines.slice(0, separator).findIndex((line) => matcher.test(line.trim()));
  if (value === null || value === '') {
    if (index >= 0) lines.splice(index, 1);
    return;
  }

  const entry = `${key}: ${value}`;
  if (index >= 0) {
    lines[index] = entry;
    return;
  }
  const timestamp = lines.findIndex((line, lineIndex) => lineIndex < separator && /^(created|updated)\s*:/i.test(line.trim()));
  lines.splice(timestamp >= 0 ? timestamp : separator, 0, entry);
}

async function updatePlaylist(input) {
  const records = await loadRecords(playlistsDirectory, true);
  assertWritable(records, validateCollection(records));
  const target = records.find((record) => record.file === input.file);
  if (!target) throw new StoreError('Playlist was not found. Refresh and try again.', 404);

  const name = cleanText(input.name, 'playlist name');
  const parentName = cleanText(input.parent, 'parent playlist', { optional: true });
  const description = cleanText(input.description, 'description', { optional: true });
  const tags = cleanTags(input.tags);
  const oldName = target.playlist.name;
  const renamed = name !== oldName;
  if (records.some((record) => record.file !== target.file && tagKey(record.playlist.name) === tagKey(name))) {
    throw new StoreError(`A playlist named "${name}" already exists.`, 409);
  }

  if (parentName && !records.some((record) => tagKey(record.file === target.file ? name : record.playlist.name) === tagKey(parentName))) {
    throw new StoreError(`Parent playlist "${parentName}" was not found.`, 404);
  }

  const descriptionChanged = description !== (target.playlist.description || '');
  const parentChanged = parentName !== (target.playlist.parent || '');
  const tagsChanged = JSON.stringify(tags) !== JSON.stringify(target.playlist.tags || []);
  const updates = [];
  const nextRecords = [];
  for (const record of records) {
    const lines = record.text.split(/\r?\n/);
    let changed = false;
    if (record.file === target.file) {
      if (renamed) {
        setPlaylistHeader(lines, 'playlist', serializeHeaderValue(name));
        changed = true;
      }
      if (parentChanged) {
        setPlaylistHeader(lines, 'parent', parentName ? serializeHeaderValue(parentName) : null);
        changed = true;
      }
      if (descriptionChanged) {
        setPlaylistHeader(lines, 'description', description ? serializeHeaderValue(description) : null);
        changed = true;
      }
      if (tagsChanged) {
        setPlaylistHeader(lines, 'tags', tags.length ? serializeTagList(tags) : null);
        changed = true;
      }
    } else if (renamed && record.playlist.parent && tagKey(record.playlist.parent) === tagKey(oldName)) {
      setPlaylistHeader(lines, 'parent', serializeHeaderValue(name));
      changed = true;
    }

    if (changed) refreshUpdatedTimestamp(lines);
    const hasFinalNewline = record.text.endsWith('\n');
    const text = `${lines.join('\n')}${hasFinalNewline ? '\n' : ''}`;
    const parsed = parsePlaylistText(text, record.file);
    nextRecords.push({ ...parsed, file: record.file, absolute: record.absolute, text });
    if (changed) updates.push({ absolute: record.absolute, text });
  }

  const issues = validateCollection(nextRecords);
  if (issues.length) throw new StoreError(issues[0].message, 400);
  for (const update of updates) await writeAtomically(update.absolute, update.text);
  if (tagsChanged) await registerTagNames(tags);
  return { file: target.file };
}

function refreshUpdatedTimestamp(lines) {
  const index = lines.findIndex((line) => /^updated\s*:/i.test(line.trim()));
  if (index < 0) throw new StoreError('Playlist is missing its updated timestamp.', 409);
  const previous = Date.parse(lines[index].trim().replace(/^updated\s*:\s*/i, ''));
  const timestamp = new Date(Math.max(Date.now(), previous + 1)).toISOString();
  lines[index] = `updated: ${timestamp}`;
}

function validateChangedPlaylist(records, target, text) {
  const parsed = parsePlaylistText(text, target.file);
  const nextRecords = records.map((record) => record.file === target.file
    ? { ...parsed, file: record.file, absolute: record.absolute, text }
    : record);
  const issues = validateCollection(nextRecords);
  if (issues.length) throw new StoreError(issues[0].message, 400);
}

async function writeAtomically(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryFile, text, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryFile, file);
  } finally {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
  }
}

async function addSong(input) {
  const records = await loadRecords(playlistsDirectory, true);
  const issues = validateCollection(records);
  assertWritable(records, issues);

  const target = records.find((record) => record.file === input.file);
  if (!target) throw new StoreError('Playlist was not found. Refresh and try again.', 404);
  const song = {
    artist: cleanText(input.artist, 'artist', { optional: true }),
    title: cleanText(input.title, 'title', { optional: true }),
    isrc: cleanText(input.isrc, 'ISRC', { optional: true }),
    tags: cleanTags(input.tags),
  };
  if (!song.artist && !song.title && !song.isrc) {
    throw new StoreError('Enter a song or artist.');
  }
  await registerTagNames(song.tags);
  const line = serializeTrack(song);
  const lines = target.text.split(/\r?\n/);
  const hasFinalNewline = target.text.endsWith('\n');
  if (hasFinalNewline) lines.pop();
  lines.push(line);
  refreshUpdatedTimestamp(lines);
  const text = `${lines.join('\n')}${hasFinalNewline ? '\n' : ''}`;
  validateChangedPlaylist(records, target, text);
  await writeAtomically(target.absolute, text);
  return { file: target.file };
}

async function importSongs(input) {
  const records = await loadRecords(playlistsDirectory, true);
  assertWritable(records, validateCollection(records));
  if (!Array.isArray(input.songs) || input.songs.length === 0) throw new StoreError('The playlist has no importable songs.');
  if (input.songs.length > 10000) throw new StoreError('A single import is limited to 10,000 songs.');
  const songs = input.songs.map((item) => {
    const artist = cleanText(item?.artist, 'artist', { optional: true });
    const title = cleanText(item?.title, 'title', { optional: true });
    if (!artist && !title) throw new StoreError('An imported song has no artist or title.');
    return { artist, title, tags: [] };
  });
  const trackLines = songs.map(serializeTrack);

  if (input.file) {
    const target = records.find((record) => record.file === input.file);
    if (!target) throw new StoreError('Playlist was not found. Refresh and try again.', 404);
    const lines = target.text.split(/\r?\n/);
    const hasFinalNewline = target.text.endsWith('\n');
    if (hasFinalNewline) lines.pop();
    lines.push(...trackLines);
    refreshUpdatedTimestamp(lines);
    const text = `${lines.join('\n')}${hasFinalNewline || trackLines.length ? '\n' : ''}`;
    validateChangedPlaylist(records, target, text);
    await writeAtomically(target.absolute, text);
    return { file: target.file, imported: songs.length };
  }

  const name = cleanText(input.name, 'playlist name');
  if (records.some((record) => tagKey(record.playlist.name) === tagKey(name))) {
    throw new StoreError(`A playlist named "${name}" already exists. Choose an existing playlist as the destination or enter a different new playlist name.`, 409);
  }
  const description = cleanText(input.description, 'description', { optional: true });
  const now = new Date().toISOString();
  const header = serializePlaylist({ name, description, created: now, updated: now });
  const text = `${header}${trackLines.join('\n')}\n`;
  const candidate = parsePlaylistText(text, '<playlist import>');
  const issues = validateCollection([...records, candidate]);
  if (issues.length) throw new StoreError(issues[0].message, 400);

  await fs.mkdir(playlistsDirectory, { recursive: true });
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    const file = filenameFor(name, suffix);
    const absolute = path.join(playlistsDirectory, file);
    try {
      await fs.writeFile(absolute, text, { encoding: 'utf8', flag: 'wx' });
      return { file, imported: songs.length };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new StoreError('Could not choose an unused playlist filename.', 409);
}

async function setSongTags(input) {
  const records = await loadRecords(playlistsDirectory, true);
  assertWritable(records, validateCollection(records));
  const target = records.find((record) => record.file === input.file);
  if (!target) throw new StoreError('Playlist was not found. Refresh and try again.', 404);
  const song = target.playlist.songs.find((item) => item.line === input.line);
  if (!song) throw new StoreError('Song was not found. Refresh and try again.', 404);
  const tags = cleanTags(input.tags);
  await registerTagNames(tags);

  const lines = target.text.split(/\r?\n/);
  lines[song.line - 1] = serializeTrack({ ...song, tags });
  const hasFinalNewline = target.text.endsWith('\n');
  refreshUpdatedTimestamp(lines);
  const text = `${lines.join('\n')}${hasFinalNewline ? '\n' : ''}`;
  validateChangedPlaylist(records, target, text);
  await writeAtomically(target.absolute, text);
  return { file: target.file };
}

async function removeSong(input) {
  const records = await loadRecords(playlistsDirectory, true);
  assertWritable(records, validateCollection(records));
  const target = records.find((record) => record.file === input.file);
  if (!target) throw new StoreError('Playlist was not found. Refresh and try again.', 404);
  const song = target.playlist.songs.find((item) => item.line === input.line);
  if (!song) throw new StoreError('Song was not found. Refresh and try again.', 404);

  const lines = target.text.split(/\r?\n/);
  const hasFinalNewline = target.text.endsWith('\n');
  lines.splice(song.line - 1, 1);
  refreshUpdatedTimestamp(lines);
  const text = `${lines.join('\n')}${hasFinalNewline ? '\n' : ''}`;
  validateChangedPlaylist(records, target, text);
  await writeAtomically(target.absolute, text);
  return { file: target.file };
}

async function moveSong(input) {
  const records = await loadRecords(playlistsDirectory, true);
  assertWritable(records, validateCollection(records));
  const target = records.find((record) => record.file === input.file);
  if (!target) throw new StoreError('Playlist was not found. Refresh and try again.', 404);
  const songIndex = target.playlist.songs.findIndex((item) => item.line === input.line);
  if (songIndex < 0) throw new StoreError('Song was not found. Refresh and try again.', 404);
  const destinationIndex = Number(input.toIndex);
  if (!Number.isInteger(destinationIndex) || destinationIndex < 0 || destinationIndex >= target.playlist.songs.length) {
    throw new StoreError('Drop target is not a valid song position.');
  }
  if (destinationIndex === songIndex) return { file: target.file };

  const lines = target.text.split(/\r?\n/);
  const trackLines = target.playlist.songs.map((song) => lines[song.line - 1]);
  const [movedLine] = trackLines.splice(songIndex, 1);
  trackLines.splice(destinationIndex, 0, movedLine);
  target.playlist.songs.forEach((song, index) => { lines[song.line - 1] = trackLines[index]; });
  const hasFinalNewline = target.text.endsWith('\n');
  refreshUpdatedTimestamp(lines);
  const text = `${lines.join('\n')}${hasFinalNewline ? '\n' : ''}`;
  validateChangedPlaylist(records, target, text);
  await writeAtomically(target.absolute, text);
  return { file: target.file };
}

async function updateTagMetadata(input) {
  return queueTagMetadata(async () => {
    const oldName = cleanText(input.oldName, 'current tag');
    const newName = cleanText(input.name, 'tag name');
    const color = cleanText(input.color, 'tag color');
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new StoreError('Tag color must be a six-digit hex color.');

    const entries = await ensureTagMetadata();
    const oldKey = tagKey(oldName);
    const current = entries.find((entry) => tagKey(entry.name) === oldKey);
    if (!current) throw new StoreError(`Tag "${oldName}" was not found.`, 404);
    if (entries.some((entry) => tagKey(entry.name) === tagKey(newName) && tagKey(entry.name) !== oldKey)) {
      throw new StoreError(`A tag named "${newName}" already exists.`, 409);
    }

    if (newName !== current.name) {
      const records = await loadRecords(playlistsDirectory, true);
      assertWritable(records, validateCollection(records));
      const updates = [];
      const nextRecords = [];
      for (const record of records) {
        const lines = record.text.split(/\r?\n/);
        let changed = false;
        if ((record.playlist.tags || []).some((tag) => tagKey(tag) === oldKey)) {
          const tags = record.playlist.tags.map((tag) => tagKey(tag) === oldKey ? newName : tag);
          const tagLine = lines.findIndex((line) => /^tags\s*:/i.test(line.trim()));
          if (tagLine >= 0) lines[tagLine] = `tags: ${serializeTagList(tags)}`;
          changed = true;
        }
        for (const song of record.playlist.songs || []) {
          if (!song.tags.some((tag) => tagKey(tag) === oldKey)) continue;
          const tags = song.tags.map((tag) => tagKey(tag) === oldKey ? newName : tag);
          lines[song.line - 1] = serializeTrack({ ...song, tags });
          changed = true;
        }

        if (changed) refreshUpdatedTimestamp(lines);
        const hasFinalNewline = record.text.endsWith('\n');
        const text = `${lines.join('\n')}${hasFinalNewline ? '\n' : ''}`;
        const parsed = parsePlaylistText(text, record.file);
        nextRecords.push({ ...parsed, file: record.file, absolute: record.absolute, text });
        if (changed) updates.push({ absolute: record.absolute, text });
      }
      const issues = validateCollection(nextRecords);
      if (issues.length) throw new StoreError(issues[0].message, 400);

      for (const update of updates) await writeAtomically(update.absolute, update.text);
    }
    const nextMetadata = entries.map((entry) => tagKey(entry.name) === oldKey
      ? { name: newName, color: color.toLowerCase() }
      : entry);
    await writeTagMetadataFile(nextMetadata);
    return sortedTagMetadata(nextMetadata);
  });
}

module.exports = {
  getPlaylistsDirectory: () => playlistsDirectory,
  setPlaylistsDirectory: serializeAccess(async (directory) => {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
      throw new StoreError('Playlist folder must be an absolute path.');
    }
    const resolved = path.resolve(directory);
    const info = await fs.stat(resolved).catch((error) => {
      if (error.code === 'ENOENT') throw new StoreError('Playlist folder does not exist.');
      throw error;
    });
    if (!info.isDirectory()) throw new StoreError('Playlist folder must be a directory.');
    playlistsDirectory = resolved;
    return playlistsDirectory;
  }),
  readPlaylistFiles: serializeAccess(async (directory = playlistsDirectory) => {
    return loadRecords(directory);
  }),
  applyPlaylistFiles: serializeAccess(async (files, directory = playlistsDirectory) => {
    const records = await loadRecords(directory, true);
    const issueList = validateCollection(records);
    assertWritable(records, issueList);
    const incoming = new Map();
    const candidates = new Map(records.map((record) => [record.file.toLocaleLowerCase('en-US'), record]));
    for (const file of files) {
      const relative = String(file.path || '').replace(/\\/g, '/');
      if (!relative || relative.startsWith('/') || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
        throw new StoreError(`Unsafe playlist path: ${relative}`, 400);
      }
      if (!relative.toLowerCase().endsWith('.lista')) throw new StoreError(`Not a .lista file: ${relative}`, 400);
      if (Object.prototype.hasOwnProperty.call(file, 'expectedText')) {
        const existing = records.find((record) => record.file === relative);
        if (existing?.text !== file.expectedText) {
          throw new StoreError(`${relative} changed while syncing. Its newer local edits were kept. Sync again.`, 409);
        }
      }
      const text = String(file.text);
      const parsed = parsePlaylistText(text, relative);
      incoming.set(relative, text);
      candidates.set(relative.toLocaleLowerCase('en-US'), { ...parsed, file: relative, absolute: path.join(directory, ...relative.split('/')), text });
    }
    const problems = validateCollection([...candidates.values()]);
    if (problems.length) throw new StoreError(`GitHub playlists failed validation: ${problems[0].source}: ${problems[0].message}`, 409);
    for (const [relative, text] of incoming) {
      await writeAtomically(path.join(directory, ...relative.split('/')), text);
    }
    return [...incoming.keys()];
  }),
  StoreError,
  collectionFingerprint,
  getLibrary: serializeAccess(getLibrary),
  validateDirectory: serializeAccess(validateDirectory),
  createPlaylist: serializeAccess(createPlaylist),
  setPlaylistParent: serializeAccess(setPlaylistParent),
  updatePlaylist: serializeAccess(updatePlaylist),
  addSong: serializeAccess(addSong),
  importSongs: serializeAccess(importSongs),
  importSpotifySongs: serializeAccess(importSongs),
  setSongTags: serializeAccess(setSongTags),
  removeSong: serializeAccess(removeSong),
  moveSong: serializeAccess(moveSong),
  getTagMetadata,
  registerTagNames,
  updateTagMetadata: serializeAccess(updateTagMetadata),
};
