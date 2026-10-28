# Desktop builds and releases

Playlista uses Electron 45 and electron-builder. The backend runs inside the desktop main process on a dynamically assigned loopback port. The interface uses a stable `playlista://app` origin, so local preferences survive backend port changes. Quitting cancels music helpers and waits for local writes and an active sync before exiting (with a 35-second shutdown deadline). A single-instance lock prevents duplicate desktop instances. `npm start` remains available for browser development.

## Downloads

| Platform | Architecture | Artifacts |
| --- | --- | --- |
| Windows | x64 | Setup `.exe` and portable `.exe` |
| macOS | x64 (Intel) | `.dmg` and `.zip` |
| macOS | arm64 (Apple Silicon) | `.dmg` and `.zip` |
| Linux | x64 | `.AppImage` and `.tar.gz` |

Linux builds use Ubuntu 22.04 (glibc 2.35); this is the baseline for the bundled native helpers. ARM Windows and ARM Linux are not in the release matrix. Each Mac architecture is built separately, including its native Python helpers. Cross-compiling helpers or combining them into a universal Mac bundle is not supported by this build setup.

Release artifacts contain the application and frozen Python adapters, not your playlists, settings, cookies, `.venv`, or developer checkout. The build uses a separate ignored `.build-venv`, `build/`, and `dist/`. Dependency notices are included under `resources/helpers/THIRD_PARTY_NOTICES.txt`; tagged source and integration requirements are available in this repository. No hosted Playlista service is required.

## Build locally

Use Node 24+, Python 3.10+ (CI uses 3.12), and the native OS/architecture you are building for:

```sh
npm ci
npm run dist
npm run test:packaged
```

On PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`. `dist` installs the pinned integration packages and PyInstaller into `.build-venv`, freezes both helpers, probes their imports without logging into music services, generates platform icons from the favicon, and builds packages under `dist/`. Users of the downloads do not need Node or Python installed. The build checks helper platform/architecture before packaging.

`npm run desktop` opens the development desktop app. `npm run test:desktop` runs its isolated smoke test. Development integrations can be installed with `npm run setup:youtube` and `npm run setup:spotify` as before. All smoke tests use temporary app data, create a test playlist, and check that quitting releases the server port; packaged tests also require both bundled helpers to load. They never use your existing music connections or library.

On a Linux machine without a desktop display, run `xvfb-run -a npm run test:packaged`. Building/running needs the usual Electron desktop libraries (GTK 3, NSS, ALSA, GBM); running an AppImage may also require FUSE 2. The release workflow installs these on its runner. The `.tar.gz` is available for systems without AppImage/FUSE support. Run desktop binaries as a normal user with Chromium's sandbox enabled.

## Create a release

First commit and push your changes, including the workflows and lockfile. Work from a clean branch that tracks the same branch on `origin` and matches the remote branch. The command requires Git write access to that branch; protected branches should use the manual tag path below after merging a version bump PR.

Preview without changing anything or contacting the remote:

```sh
npm run release -- patch --dry-run
```

Then create the release:

```sh
npm run release -- patch
```

Use `minor`, `major`, or an explicit increasing version such as `0.2.0` or `0.2.0-beta.1` instead of `patch`. Running `npm run release` without arguments prints usage. The command:

1. Checks for uncommitted changes, upstream configuration, local/remote tag collisions, and remote branch divergence.
2. Updates `package.json` and `package-lock.json` using `npm version`.
3. Commits only those version files and creates an annotated `v<version>` tag.
4. Atomically pushes the release commit and tag to `origin`, without force.

The first release from the current `0.1.0` package would be `v0.1.1` with `patch`. To release `v0.1.0` itself, use the manual tag path without bumping. The command does not publish the draft, run `npm publish`, or upload personal playlists.

If a commit/tag succeeds locally but the push fails, fix the remote access/branch issue and retry the displayed atomic push; the script deliberately keeps the local release commit and tag. Do not bump again just to retry an upload. An atomic push requires the Git server's atomic-push support (GitHub supports it).

## GitHub Actions

`.github/workflows/desktop-release.yml` runs on `v*` tags and can also be run manually from **Actions → Desktop builds → Run workflow**. It builds on Windows, Intel macOS, Apple Silicon macOS, and Linux. Each job verifies its native architecture and tag/version agreement, builds the helpers and packages, runs regression tests, and smoke-tests the unpacked packaged app. Downloads are uploaded as workflow artifacts only after those checks pass.

For version tags, a final job waits for every platform to pass, generates `SHA256SUMS.txt`, and creates a **draft GitHub Release** containing all downloads and checksums. Review it in **Releases**, then publish it. Manual workflow runs produce downloadable Actions artifacts without creating a release. No personal access token is needed: only the draft job receives the repository's built-in `GITHUB_TOKEN` with `contents: write`; build jobs have read-only repository access. Actions must be enabled for this app repository.

`.github/workflows/ci.yml` runs the regression suite on Windows, macOS, and Linux for PRs and pushes to `main`. Build jobs verify their packaged binaries; manual testing on the actual target OS is still needed for UI/platform behavior and real music-service connections. An Actions build is not a live Spotify/YouTube account test.

For a protected branch or manual versioning, merge the version change first, then tag the matching committed version:

```sh
git tag -a v0.2.0 -m "Playlista 0.2.0"
git push origin v0.2.0
```

The version in the tag must match `package.json`. If a build fails, fix the cause and re-run failed jobs where appropriate. Use a new version/tag when changing released source; do not move an existing release tag.

## Signing

Builds work without signing credentials. Windows outputs are unsigned, and macOS builds are unsigned/ad-hoc rather than Developer ID signed and notarized. Operating systems may block or prompt when opening those downloads. Automatic signing/notarization requires your own credentials; none are checked into this repository.

Optional repository Actions secrets:

| Secrets | Purpose |
| --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS signing certificate (`.p12` as base64 or a supported certificate URL) and password |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD` | Apple notarization; enabled when all three are supplied |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows signing certificate and password |

Use a consistent macOS signature to keep Keychain access stable across updates. Auto-updates are not wired up yet: install a newer release manually, keeping the same playlist folder and app-data directory.

`npm run dist` invokes `scripts/package-desktop.js`, which removes empty certificate-path variables before starting electron-builder. Missing Actions secrets expand to empty strings; passing `CSC_LINK=""` directly to electron-builder makes its Mac signer interpret the checkout directory as a certificate and fail with “not a file.” Configured certificates and intentionally empty certificate passwords are retained.

For public downloads while the app source stays private, use `npm run release:publish -- v<version>` after every platform completes. See [website and public downloads](WEBSITE.md).

## Data and integrations

Installed apps default to `Documents/Playlista/playlists`; the selected playlist folder can be changed in Settings. Settings/tag metadata/encrypted connections live in Electron's per-user app-data folder named `Playlista`. Windows portable refers to installation only; it uses the same per-user storage rather than placing credentials beside the executable. Development desktop storage is separate (`Playlista Development`). Existing browser-mode libraries are not moved automatically: select their folder in Settings. App updates and installer uninstall preserve the configured library; the installer does not delete app data.

Desktop connections use OS-backed encryption: DPAPI, Keychain, or a supported Linux keyring. Without a secure keyring, Linux connections remain session-only. Plaintext fallback is disabled. Credentials are not included in releases or GitHub playlist sync.

GitHub backup still uses an installed, authenticated `gh` executable. Git itself is not required by end users for ordinary playlist editing or GitHub sync. Git is needed by maintainers for the release command. Desktop launches also check standard Homebrew and user-local executable directories; custom installations must be on the application's PATH.
