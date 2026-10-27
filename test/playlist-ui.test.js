const test = require('node:test');
const assert = require('node:assert/strict');
const { formatPlaylistDate, shouldFocusQuickAdd } = require('../public/playlist-ui');

const now = new Date('2026-10-27T12:00:00.000Z');
const hour = 60 * 60 * 1000;
const day = 24 * hour;
const ago = (elapsed) => new Date(now.getTime() - elapsed).toISOString();

test('playlist dates use elapsed hours and days at the requested boundaries', () => {
  const label = (elapsed) => formatPlaylistDate(ago(elapsed), now, 'en-US').label;
  assert.equal(label(0), 'Less than an hour ago');
  assert.equal(label(hour - 1), 'Less than an hour ago');
  assert.equal(label(hour), '1 hour ago');
  assert.equal(label(day - 1), '23 hours ago');
  assert.equal(label(day), '1 day ago');
  assert.equal(label(30 * day - 1), '29 days ago');
  const old = new Date(ago(30 * day));
  assert.equal(label(30 * day), new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(old));
});

test('older and future dates retain compact labels and the exact date in their title', () => {
  const old = formatPlaylistDate('2025-10-20T12:00:00.000Z', now, 'en-US');
  assert.equal(old.label, 'October 2025');
  assert.match(old.full, /2025/);
  assert.equal(old.full, new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short' }).format(new Date('2025-10-20T12:00:00.000Z')));
  assert.doesNotMatch(formatPlaylistDate(ago(-day), now, 'en-US').label, /ago/);
  assert.deepEqual(formatPlaylistDate('invalid', now), { label: 'invalid', full: 'invalid' });
});

test('typing can start quick add only on a visible playlist outside editors and dialogs', () => {
  const key = { key: 'S' };
  assert.equal(shouldFocusQuickAdd(key, { playlistVisible: true }), true);
  assert.equal(shouldFocusQuickAdd(key, { playlistVisible: false }), false);
  assert.equal(shouldFocusQuickAdd(key, { playlistVisible: true, editing: true }), false);
  assert.equal(shouldFocusQuickAdd(key, { playlistVisible: true, modalOpen: true }), false);
  assert.equal(shouldFocusQuickAdd({ key: ' ' }, { playlistVisible: true, interactive: true }), false);
  assert.equal(shouldFocusQuickAdd({ key: ' ' }, { playlistVisible: true }), true);
});

test('quick add leaves shortcuts, navigation keys and composition alone while accepting AltGr text', () => {
  const view = { playlistVisible: true };
  for (const event of [
    { key: 'k', ctrlKey: true }, { key: 'a', metaKey: true }, { key: 'x', altKey: true },
    { key: 'a', isComposing: true }, { key: 'a', defaultPrevented: true },
    ...['Tab', 'Enter', 'Escape', 'ArrowDown', 'Dead'].map((key) => ({ key })),
  ]) assert.equal(shouldFocusQuickAdd(event, view), false, JSON.stringify(event));
  assert.equal(shouldFocusQuickAdd({ key: '@', ctrlKey: true, altKey: true, getModifierState: (key) => key === 'AltGraph' }, view), true);
  assert.equal(shouldFocusQuickAdd({ key: 'A', shiftKey: true }, view), true);
});
