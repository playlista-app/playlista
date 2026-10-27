# Playlista

Playlista keeps playlist definitions as portable `.lista` text files. [SPEC.md](SPEC.md) defines the format. The Node app includes a validator and a small local editor; it has no external package dependencies.

## Run the local app

Requires Node.js 18 or newer. From the project folder:

```sh
node src/server.js
```

Open [http://127.0.0.1:43817](http://127.0.0.1:43817). The app binds to localhost only and writes playlists to `playlists/` by default. Set the `PORT` environment variable to use another port; the matching Spotify callback URL is shown in Settings. The default callback is `http://127.0.0.1:43817/spotify/callback`.

The server runs in the foreground; Ctrl+C in that terminal stops it. `playlists/` and `data/` are personal runtime data and are ignored by this app repository. The app creates the default playlist folder when needed. You can select another existing folder in Settings; a folder outside the app checkout also keeps the app and your library separate.

The editor can create and edit playlists, set their parents, and add track searches with optional tags. Quick add starts as a song field; Tab and Shift+Tab move through Song, Artist, and Tags, while commas commit tags. Existing tags are suggested as you type, and new tags are saved in the app's shared tag metadata. Drag playlists in the sidebar to change their parent, and drag anywhere on an owned song row to reorder it. Song tags can be added from each playlist row. The overview shows playlist counts, descriptions, dates, and a **Your tags** section. Selecting a tag opens its playlist when there is one match, or filtered library results when it appears across multiple playlists; its pen edits the tag name and display color. Renaming a tag updates its name in playlist files; color changes stay in `data/tag-metadata.json` and never enter `.lista` files. Playlist dates show a compact label with the exact local date and time on hover.

A playlist view shows its own songs first, followed by songs from its child playlists and deeper descendants; inherited rows link back to the playlist that owns them. The total track count appears beside the playlist title. Quick add stays at the top of the screen while scrolling. Typing from the playlist view focuses the current quick-add property and keeps the first character; other inputs, dialogs, and keyboard shortcuts retain their normal behavior.

On desktop, the sidebar stays below the top bar and fits the viewport. Only its playlist tree scrolls; Overview, Settings, and the resize handle stay visible while browsing long playlists.

Creating a playlist sets `created` and `updated`; adding, removing, retagging, reordering a song, or changing a parent updates `updated`. Dates within 24 hours show elapsed hours (or "Less than an hour ago"); dates within 30 days show elapsed days. Older dates keep the compact month/day or month/year label, with the exact date and time on hover.

The top search scans playlist names, descriptions, tags, and directly owned song entries. It accepts filters such as `tag:hype`, `description:emo`, `playlist:punk`, `artist:blink`, and `title:anthem`. A song match appears only under the playlist that owns its `.lista` line, even when that song is also visible in an ancestor's combined view.

## Validate playlists

Validate the live playlist folder:

```sh
node src/cli.js
```

Pass a folder as an argument to validate another collection. The linter reports file and line locations for syntax problems, plus collection errors such as duplicate playlist names, missing parents, and parent cycles. Cycle errors include the loop. Examples and version migration details are in [SPEC.md](SPEC.md).

Run the regression checks with `npm test`. They use generated playlist content, temporary local folders, and a mocked GitHub API. They do not connect to GitHub or modify your library.

Browser checks run when Chrome or Edge is installed on Windows and Node exposes `WebSocket` (Node 22+). On other platforms, set `PLAYLISTA_BROWSER_EXE` to a Chromium-based browser executable. These checks use a temporary browser profile and close the browser and local test server afterward; they are skipped when the required browser support is unavailable.

## Local and GitHub storage

Files in the selected local folder are the live library. They are ordinary `.lista` files and remain usable offline. GitHub is opt-in. Run `gh auth login` for the accounts you want available, then select the account in Settings. Playlista lists authenticated logins, marks the CLI active account, and uses the accepted choice without switching the CLI's active account. It does not save the token in app settings. The selected account needs repository **Contents: read and write** permission.

The local folder maps directly to the repository root: `punk.lista` stays `punk.lista`, and `decades/90s.lista` stays `decades/90s.lista`. There is no separate repository folder setting. Only `.lista` files participate; other remote files are preserved. An empty GitHub repository is supported: saving the first playlist creates its first commit. A local Git checkout is optional; Playlista compares file contents with its last synced snapshot.

Enable **Auto-sync to GitHub** to save after a short pause in editing. Changes made outside the UI are detected as well. While the server runs, GitHub is checked periodically for incoming changes, which are imported automatically when the local copy has not also changed. With auto-sync disabled, **Import from GitHub** and **Save to GitHub** remain available, and remote checks still reveal mismatches.

Import and save never delete playlist files. A missing copy can be restored from the other side. After the first matching sync, the app tracks a local sync baseline so it can apply one-sided edits in either direction. If both copies differ, the file is reported as a conflict and neither copy is overwritten unless you explicitly choose which version to keep. Importing remote playlist files validates the combined library before writing and preserves edits made locally while a sync was in flight.

Each playlist shows when its current contents were synced, or how many changes remain. Counts compare text with the last synced copy, excluding timestamp changes; a new file, a reorder, or a timestamp-only change counts once. The top-right warning counts affected playlist files, including remote mismatches. Sync failures remain visible while the local library stays usable.

Unsynced playlists have a **Sync** button that works with auto-sync disabled. It imports or saves one-sided changes for that playlist and includes missing parent playlists when needed. Conflicts go to Settings for review. If a structural change, such as renaming a parent, needs other child files to change in the same sync, use the library-wide controls in Settings.

Local app settings and sync snapshots are stored in `data/app-settings.json`; tag colors are stored in `data/tag-metadata.json`. The whole `data/` directory is excluded from the app's Git repository. It does not contain a GitHub token.

## Spotify import

Settings includes a Spotify importer. Create a Spotify developer app, register the exact redirect URI shown in Settings, and enter its Client ID. Connect Spotify, load your playlists, and import into a new playlist or append to an existing one. Artist/title queries, ordering, duplicate tracks, and playlist descriptions are preserved; episodes and unavailable items are skipped. [Spotify's development restrictions](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide) limit full playlist contents to playlists you own or collaborate on, and require Premium for the app owner. OAuth uses PKCE; tokens remain in memory for the running app session.

## YouTube Music import and export

The YouTube Music integration runs locally using the Python [ytmusicapi](https://ytmusicapi.readthedocs.io/en/stable/) library. It needs Python 3.10+ and has no hosted Playlista backend or paid API key. Install its dependencies once:

```sh
npm run setup:youtube
```

On Windows PowerShell, use `npm.cmd run setup:youtube` if script execution policy blocks `npm.ps1`. Setup creates an ignored `.venv/` inside this repo; it does not install packages globally. Set `PLAYLISTA_PYTHON` to a Python executable if necessary. Once configured, `npm start` launches the Node app and it starts short-lived Python helpers automatically when needed. There is no separate Python server to start.

In **Settings → YouTube Music**, connect using a signed-in browser session:

1. Sign in to `music.youtube.com` with the intended Google/YouTube account.
2. Open developer tools, select **Network**, and click **Library**. Select a successful POST request containing `/browse`.
3. Copy its **request headers**, including Cookie and Authorization. Paste them into Playlista. Raw headers, Chrome's **Copy as fetch (Node.js)**, and the library's `browser.json` JSON are supported. See the [library's browser authentication guide](https://ytmusicapi.readthedocs.io/en/stable/setup/browser.html).
4. Click **Check account**, review the returned account name and handle, then **Use this account**. This does not require creating a Google Cloud app. Reconnect with fresh headers if the browser session expires or you sign out.

Treat these headers as credentials. They are sent only to the local helper and YouTube Music, cleared from the input after checking, and never included in `.lista` files, GitHub sync, URLs, or app settings. With **Remember on this computer**, Windows DPAPI encrypts the connection for the current Windows user in ignored `data/youtube-connection.json`. Disconnect removes that saved connection. On other operating systems, connections remain in memory until the app exits; persistent OS credential storage can be added alongside a desktop wrapper. Tests can override the credential path with `PLAYLISTA_YOUTUBE_CREDENTIALS_FILE`.

**Import:** load your library playlists or paste a playlist URL/ID. Create a new local playlist or append to an existing one. Imports stay on the import screen so you can import several playlists in succession; the affected playlist briefly flashes green in the sidebar. Artist/title queries, playlist description, track order, and duplicates are preserved. Unavailable tracks and recognized podcast episodes are skipped and counted. Imports use the same validated local writes as other edits and participate in GitHub auto-sync when enabled. A single import is limited to 10,000 songs.

**Export:** open a local playlist and select **Export to YouTube Music**. Its own songs and child playlists are included in the same order shown in Playlista. This starts the export immediately: each song uses YouTube Music's first search result, including title-only queries such as `Basket Case`. There is no per-song review step. These assumptions can choose another recording or artist; the results page shows every original query beside the chosen YouTube Music track, with counts and a filter for skipped/not-found songs. Search failures are distinguished from empty search results. Browser Back/Forward restores the results view.

Large exports deduplicate identical queries and reuse one Python/API instance per batch of 25 distinct queries, with at most two lookup batches running at once. Progress is streamed per query; status polling omits candidate lists. Results display 50 songs per page to keep the interface responsive. These bounds reduce local process overhead and concurrency; actual export duration still depends on YouTube Music's response times and rate limits.

Export creates a **new private playlist**. Existing YouTube Music playlists are never overwritten. Order and duplicates are preserved; the helper verifies the completed track list. Partial failures retain a link to the created playlist for inspection and identify matches whose additions could not be fully verified. If no songs match, the results page lists the skips and no empty remote playlist is created. If a request times out, check your YouTube Music library before starting another export. Source songs, folder, and account are checked again before writing; edits made during matching require a fresh export. Matching can be cancelled before the remote write starts. Provider IDs stay outside the portable playlist format.

`ytmusicapi` is unofficial and can break when YouTube changes its website; rate limits and session expiry still apply. The tests use fake provider responses, a real browser, and a Windows encryption round trip. Live account import/export requires connecting your own account and is not performed by the test suite.

## Direction

The format and linter are independent of music services. Spotify export can follow the same file and format boundary as import. A desktop wrapper is also a good next packaging step: Electron's main process can own the local Node server and window lifecycle. `src/server.js` exports `startServer()` so a desktop shell can wait for the API to listen before opening the window, then close it when the app exits. The Python bridge has a JSON-over-stdin/stdout boundary so a packaged helper can replace the virtual environment later. That keeps the current web UI while opening the door to native folder selection and cross-platform operating-system credential storage. The existing `node src/server.js` workflow remains useful for development.
