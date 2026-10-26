const HEADER_FIELDS = new Set(['version', 'playlist', 'parent', 'description', 'tags', 'created', 'updated']);

function issue(source, line, message) {
  return { source, line, severity: 'error', message };
}

function parseTextValue(raw, { quoteSeparator = false } = {}) {
  const value = raw.trim();
  if (!value) throw new Error('value cannot be empty');

  if (!value.startsWith('"')) {
    if (value.includes('"')) throw new Error('quote the whole value if it contains a double quote');
    if (quoteSeparator && value.includes('>')) throw new Error('quote a value containing >');
    return value;
  }

  let result = '';
  let closed = false;
  let index = 1;
  while (index < value.length) {
    const character = value[index];
    if (character === '\\') {
      const next = value[index + 1];
      if (next !== '\\' && next !== '"') throw new Error('only \\\\ and \\" are valid escapes in quoted values');
      result += next;
      index += 2;
      continue;
    }
    if (character === '"') {
      closed = true;
      index += 1;
      break;
    }
    result += character;
    index += 1;
  }

  if (!closed) throw new Error('quoted value is missing its closing double quote');
  if (value.slice(index).trim()) throw new Error('unexpected text after quoted value');
  if (!result.trim()) throw new Error('value cannot be empty');
  return result;
}

function splitOutside(raw, delimiter, respectBrackets = true) {
  const parts = [];
  let start = 0;
  let inQuotes = false;
  let bracketDepth = 0;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inQuotes) {
      if (character === '\\') {
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
      continue;
    }
    if (respectBrackets && character === '[') {
      bracketDepth += 1;
      continue;
    }
    if (respectBrackets && character === ']') {
      bracketDepth -= 1;
      if (bracketDepth < 0) throw new Error('unexpected closing bracket');
      continue;
    }
    if (character === delimiter && bracketDepth === 0) {
      parts.push(raw.slice(start, index));
      start = index + 1;
    }
  }

  if (inQuotes) throw new Error('quoted value is missing its closing double quote');
  if (bracketDepth !== 0) throw new Error('tag list is missing its closing bracket');
  parts.push(raw.slice(start));
  return parts;
}

function parseTagList(raw) {
  const value = raw.trim();
  if (!value.startsWith('[') || !value.endsWith(']')) throw new Error('tag list must be enclosed in square brackets');

  const contents = value.slice(1, -1);
  const items = splitOutside(contents, ',', false);
  if (!contents.trim() || items.some((item) => !item.trim())) {
    throw new Error('tag list must contain non-empty tags');
  }

  const tags = items.map((item) => {
    const tagText = item.trim();
    if (!tagText.startsWith('"') && /[>\[\]]/.test(tagText)) {
      throw new Error('quote a tag containing > or square brackets');
    }
    return parseTextValue(tagText);
  });

  const seen = new Set();
  for (const tag of tags) {
    const normalized = tag.toLocaleLowerCase('en-US');
    if (seen.has(normalized)) throw new Error(`duplicate tag: ${tag}`);
    seen.add(normalized);
  }
  return tags;
}

function parseTimestamp(raw) {
  const value = parseTextValue(raw);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error('timestamp must use UTC ISO format, for example 2026-10-26T12:34:56.789Z');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) throw new Error('timestamp is not a valid date');
  return value;
}

function parseTrackLine(raw, source, line) {
  const parts = splitOutside(raw, '>').map((part) => part.trim());
  if (parts.some((part) => !part)) throw new Error('track query contains an empty part');

  let tags = [];
  const bracketParts = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.includes('[') || part.includes(']'));
  if (bracketParts.length) {
    if (bracketParts.length !== 1 || bracketParts[0].index !== parts.length - 1) {
      throw new Error('a tag list must be the final part of a track query');
    }
    tags = parseTagList(bracketParts[0].part);
    parts.pop();
  }

  if (!parts.length) throw new Error('track query needs an artist, title, or ISRC');

  const selectors = [];
  const unlabelled = [];
  for (const part of parts) {
    const match = part.match(/^(artist|title|isrc)\s*:\s*(.*)$/i);
    if (match) {
      const field = match[1].toLowerCase();
      const value = parseTextValue(match[2]);
      if (field === 'isrc' && /[*?]/.test(value)) throw new Error('ISRC is an exact value and cannot contain wildcards');
      selectors.push({ field, value });
    } else {
      unlabelled.push(parseTextValue(part));
    }
  }

  const namedTextFields = selectors.filter(({ field }) => field === 'artist' || field === 'title');
  if (namedTextFields.length && unlabelled.length) {
    throw new Error('do not mix labelled artist/title selectors with unlabelled text');
  }
  if (unlabelled.length > 2) throw new Error('use at most two unlabelled values: artist then title');

  const result = { artist: null, title: null, isrc: null, tags, source, line, text: raw.trim() };
  for (const selector of selectors) {
    if (result[selector.field] !== null) throw new Error(`query repeats the ${selector.field} selector`);
    result[selector.field] = selector.value;
  }

  if (namedTextFields.length) {
    // Named artist/title fields were assigned above; ISRC may accompany them.
  } else if (unlabelled.length === 1) {
    result.title = unlabelled[0];
  } else if (unlabelled.length === 2) {
    result.artist = unlabelled[0];
    result.title = unlabelled[1];
  }

  if (!result.artist && !result.title && !result.isrc) {
    throw new Error('track query needs an artist, title, or ISRC');
  }
  return result;
}

function parsePlaylistText(text, source = '<memory>') {
  const playlist = {
    version: null,
    name: null,
    parent: null,
    description: null,
    tags: [],
    created: null,
    updated: null,
    songs: [],
    source,
  };
  const issues = [];
  const seenHeaders = new Set();
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  let inBody = false;
  let versionFirstLineChecked = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    const lineNumber = index + 1;
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (!inBody && trimmed === '---') {
      inBody = true;
      continue;
    }

    if (!inBody) {
      const match = trimmed.match(/^([a-z][a-z0-9_-]*)\s*:\s*(.*)$/i);
      if (!match) {
        issues.push(issue(source, lineNumber, 'expected a header field in name: value form'));
        continue;
      }

      const field = match[1].toLowerCase();
      const rawValue = match[2];
      if (!versionFirstLineChecked) {
        versionFirstLineChecked = true;
        if (field !== 'version' || rawValue.trim() !== '2') {
          issues.push(issue(source, lineNumber, 'the first non-comment line must be version: 2'));
        }
      }

      if (!HEADER_FIELDS.has(field)) {
        issues.push(issue(source, lineNumber, `unknown header field: ${match[1]}`));
        continue;
      }
      if (seenHeaders.has(field)) {
        issues.push(issue(source, lineNumber, `duplicate header field: ${field}`));
        continue;
      }
      seenHeaders.add(field);

      try {
        if (field === 'version') {
          if (rawValue.trim() !== '2') throw new Error('version must be the integer 2');
          playlist.version = 2;
        } else if (field === 'tags') {
          playlist.tags = parseTagList(rawValue);
        } else if (field === 'created' || field === 'updated') {
          playlist[field] = parseTimestamp(rawValue);
        } else {
          const value = parseTextValue(rawValue, { quoteSeparator: true });
          if (field === 'playlist') playlist.name = value;
          if (field === 'parent') playlist.parent = value;
          if (field === 'description') playlist.description = value;
        }
      } catch (error) {
        issues.push(issue(source, lineNumber, error.message));
      }
      continue;
    }

    try {
      playlist.songs.push(parseTrackLine(trimmed, source, lineNumber));
    } catch (error) {
      issues.push(issue(source, lineNumber, error.message));
    }
  }

  if (!inBody) issues.push(issue(source, null, 'missing --- separator between header and track queries'));
  if (!seenHeaders.has('version')) issues.push(issue(source, null, 'missing required version: 2 field'));
  if (!seenHeaders.has('playlist')) issues.push(issue(source, null, 'missing required playlist field'));
  if (!seenHeaders.has('created')) issues.push(issue(source, null, 'missing required created timestamp'));
  if (!seenHeaders.has('updated')) issues.push(issue(source, null, 'missing required updated timestamp'));
  if (seenHeaders.has('playlist') && !playlist.name) issues.push(issue(source, null, 'playlist name cannot be empty'));
  if (seenHeaders.has('description') && !playlist.description) issues.push(issue(source, null, 'description cannot be empty'));
  if (playlist.created && playlist.updated && Date.parse(playlist.updated) < Date.parse(playlist.created)) {
    issues.push(issue(source, null, 'updated timestamp cannot be earlier than created timestamp'));
  }

  return { playlist, issues };
}

function validateCollection(records) {
  const issues = records.flatMap((record) => record.issues || []);
  const byName = new Map();

  for (const record of records) {
    const playlist = record.playlist;
    if (!playlist?.name) continue;
    const key = playlist.name.toLocaleLowerCase('en-US');
    const found = byName.get(key) || [];
    found.push(record);
    byName.set(key, found);
  }

  for (const [key, found] of byName) {
    if (found.length < 2) continue;
    for (const record of found) {
      issues.push(issue(record.playlist.source, null, `duplicate playlist name: ${record.playlist.name}`));
    }
    byName.set(key, []);
  }

  const unique = new Map([...byName.entries()].filter(([, found]) => found.length === 1).map(([key, found]) => [key, found[0]]));
  for (const record of records) {
    const parentName = record.playlist?.parent;
    if (!parentName) continue;
    const parentKey = parentName.toLocaleLowerCase('en-US');
    if (byName.has(parentKey) && byName.get(parentKey).length === 0) {
      issues.push(issue(record.playlist.source, null, `parent reference is ambiguous because playlist name is duplicated: ${parentName}`));
    } else if (!unique.has(parentKey)) {
      issues.push(issue(record.playlist.source, null, `parent references missing playlist: ${parentName}`));
    }
  }

  const state = new Map();
  const stack = [];
  const reportedCycles = new Set();
  function visit(record) {
    const nameKey = record.playlist.name.toLocaleLowerCase('en-US');
    if (state.get(nameKey) === 2) return;
    if (state.get(nameKey) === 1) {
      const cycleStart = stack.findIndex((item) => item.playlist.name.toLocaleLowerCase('en-US') === nameKey);
      const chain = [...stack.slice(cycleStart).map((item) => item.playlist.name), record.playlist.name];
      const cycleKey = chain.map((name) => name.toLocaleLowerCase('en-US')).sort().join('|');
      if (!reportedCycles.has(cycleKey)) {
        reportedCycles.add(cycleKey);
        issues.push(issue(record.playlist.source, null, `parent cycle: ${chain.join(' -> ')}`));
      }
      return;
    }

    state.set(nameKey, 1);
    stack.push(record);
    const parentKey = record.playlist.parent?.toLocaleLowerCase('en-US');
    if (parentKey && unique.has(parentKey)) visit(unique.get(parentKey));
    stack.pop();
    state.set(nameKey, 2);
  }
  for (const record of unique.values()) visit(record);

  return issues;
}

function encodeValue(value, options = {}) {
  const text = String(value);
  const needsQuotes = /[>"\[\]]/.test(text)
    || /^\s|\s$/.test(text)
    || (options.track && /^(artist|title|isrc)\s*:/i.test(text));
  if (!needsQuotes) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function encodeTags(tags) {
  const values = tags.map((tag) => {
    const text = String(tag);
    const quote = /[,>"\[\]]/.test(text) || /^\s|\s$/.test(text);
    return quote ? `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : text;
  });
  return `[${values.join(', ')}]`;
}

function serializeTagList(tags) {
  return encodeTags(tags);
}

function serializeHeaderValue(value) {
  return encodeValue(value);
}

function serializePlaylist({ name, parent, description, tags = [], created, updated }) {
  const lines = ['version: 2', `playlist: ${encodeValue(name)}`];
  if (parent) lines.push(`parent: ${encodeValue(parent)}`);
  if (description) lines.push(`description: ${encodeValue(description)}`);
  if (tags.length) lines.push(`tags: ${encodeTags(tags)}`);
  lines.push(`created: ${created}`, `updated: ${updated}`);
  lines.push('---');
  return `${lines.join('\n')}\n`;
}

function serializeTrack({ artist, title, isrc, tags = [] }) {
  const parts = [];
  if (artist && title) {
    parts.push(encodeValue(artist, { track: true }), encodeValue(title, { track: true }));
  } else if (artist) {
    parts.push(`artist: ${encodeValue(artist, { track: true })}`);
  } else if (title) {
    parts.push(encodeValue(title, { track: true }));
  }
  if (isrc) parts.push(`ISRC: ${encodeValue(isrc, { track: true })}`);
  if (tags.length) parts.push(encodeTags(tags));
  return parts.join(' > ');
}

module.exports = {
  parsePlaylistText,
  validateCollection,
  serializePlaylist,
  serializeTrack,
  serializeTagList,
  serializeHeaderValue,
};
