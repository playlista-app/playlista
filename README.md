# Playlista

Playlista keeps playlist definitions as portable `.lista` text files. [SPEC.md](SPEC.md) defines the format. The Node app includes a validator and a small local editor; it has no external package dependencies.

## Run the local app

Requires Node.js 18 or newer. From the project folder:

```sh
node src/server.js
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The app binds to localhost only and writes playlists to `playlists/` by default.

The server runs in the foreground; Ctrl+C in that terminal stops it. `playlists/` and `data/` are personal runtime data and are ignored by this app repository. The app creates the default playlist folder when needed. You can select another existing folder in Settings; a folder outside the app checkout also keeps the app and your library separate.

The editor can create and edit playlists, set their parents, and add track searches with optional tags. Quick add starts as a song field; Tab and Shift+Tab move through Song, Artist, and Tags, while commas commit tags. Existing tags are suggested as you type, and new tags are saved in the app's shared tag metadata. Drag playlists in the sidebar to change their parent, and drag anywhere on an owned song row to reorder it. Song tags can be added from each playlist row. The overview shows playlist counts, descriptions, dates, and a **Your tags** section. Selecting a tag opens its playlist when there is one match, or filtered library results when it appears across multiple playlists; its pen edits the tag name and display color. Renaming a tag updates its name in playlist files; color changes stay in `data/tag-metadata.json` and never enter `.lista` files. Playlist dates show a compact label with the exact local date and time on hover.

A playlist view shows its own songs first, followed by songs from its child playlists and deeper descendants; inherited rows link back to the playlist that owns them. Creating a playlist sets `created` and `updated`; adding, removing, retagging, reordering a song, or changing a parent updates `updated`.

The top search scans playlist names, descriptions, tags, and directly owned song entries. It accepts filters such as `tag:hype`, `description:emo`, `playlist:punk`, `artist:blink`, and `title:anthem`. A song match appears only under the playlist that owns its `.lista` line, even when that song is also visible in an ancestor's combined view.

## Validate playlists

Validate the live playlist folder:

```sh
node src/cli.js
```

Pass a folder as an argument to validate another collection. The linter reports file and line locations for syntax problems, plus collection errors such as duplicate playlist names, missing parents, and parent cycles. Cycle errors include the loop. Examples and version migration details are in [SPEC.md](SPEC.md).

Run the regression checks with `npm test`. They use generated playlist content, temporary local folders, and a mocked GitHub API. They do not connect to GitHub or modify your library.

## Local and GitHub storage

Files in the selected local folder are the live library. They are ordinary `.lista` files and remain usable offline. GitHub is opt-in. Run `gh auth login` for the accounts you want available, then select the account in Settings. Playlista lists authenticated logins, marks the CLI active account, and uses the accepted choice without switching the CLI's active account. It does not save the token in app settings. The selected account needs repository **Contents: read and write** permission.

The local folder maps directly to the repository root: `punk.lista` stays `punk.lista`, and `decades/90s.lista` stays `decades/90s.lista`. There is no separate repository folder setting. Only `.lista` files participate; other remote files are preserved. An empty GitHub repository is supported: saving the first playlist creates its first commit. A local Git checkout is optional; Playlista compares file contents with its last synced snapshot.

Enable **Auto-sync to GitHub** to save after a short pause in editing. Changes made outside the UI are detected as well. While the server runs, GitHub is checked periodically for incoming changes, which are imported automatically when the local copy has not also changed. With auto-sync disabled, **Import from GitHub** and **Save to GitHub** remain available, and remote checks still reveal mismatches.

Import and save never delete playlist files. A missing copy can be restored from the other side. After the first matching sync, the app tracks a local sync baseline so it can apply one-sided edits in either direction. If both copies differ, the file is reported as a conflict and neither copy is overwritten unless you explicitly choose which version to keep. Importing remote playlist files validates the combined library before writing and preserves edits made locally while a sync was in flight.

Each playlist shows when its current contents were synced, or how many changes remain. Counts compare text with the last synced copy, excluding timestamp changes; a new file, a reorder, or a timestamp-only change counts once. The top-right warning counts affected playlist files, including remote mismatches. Sync failures remain visible while the local library stays usable.

Local app settings and sync snapshots are stored in `data/app-settings.json`; tag colors are stored in `data/tag-metadata.json`. The whole `data/` directory is excluded from the app's Git repository. It does not contain a GitHub token.

## Spotify import

Settings includes a Spotify importer. Create a Spotify developer app, register the exact redirect URI shown in Settings, and enter its Client ID. Connect Spotify, load your playlists, and import into a new playlist or append to an existing one. Artist/title queries, ordering, duplicate tracks, and playlist descriptions are preserved; episodes and unavailable items are skipped. [Spotify's development restrictions](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide) limit full playlist contents to playlists you own or collaborate on, and require Premium for the app owner. OAuth uses PKCE; tokens remain in memory for the running app session.

## Direction

The format and linter are independent of music services. Spotify export can follow the same file and format boundary as import. A desktop wrapper is also a good next packaging step: Electron's main process can own the local Node server and window lifecycle. `src/server.js` exports `startServer()` so a desktop shell can wait for the API to listen before opening the window, then close it when the app exits. That keeps the current web UI while opening the door to native folder selection and operating-system credential storage. The existing `node src/server.js` workflow remains useful for development.
