# Website and public downloads

The public landing page lives at **https://playlista-app.github.io/**. GitHub requires an organization site repository to be named `playlista-app.github.io`; naming it just `playlista-app` would produce a project site rather than the root site. Website source stays in this monorepo under `website/`; `playlista-app/playlista-app.github.io` hosts the static site. Application source and desktop releases are in **https://github.com/playlista-app/playlista**.

## Edit and preview

```sh
npm run site:preview
```

Open `http://127.0.0.1:43818`. Set `SITE_PORT` to use another port. The site is buildless HTML/CSS/JavaScript, with no hosted backend, analytics, account system, or runtime dependencies. Screenshots use a fictional sample library; personal playlists and credentials are not included.

To regenerate the actual app screenshots, install Chrome/Edge (or set `PLAYLISTA_BROWSER_EXE`) and run:

```sh
npm run site:capture
npm run site:check
```

Capture uses a temporary playlist directory and mocked connection statuses. It never opens your actual playlist library. Browser checks cover the screenshot tabs, desktop/mobile layout, platform detection, published download links, and the absence of a complete release. Screenshots for local visual review are written to ignored `build/site/`.

## Publish the site

Use your authenticated GitHub CLI account with access to the organization:

```sh
npm run site:publish -- --dry-run
npm run site:publish
```

On its first run, the publisher creates the public organization site repository, uploads only the files under `website/`, and enables GitHub Pages from the root of its default branch. Subsequent runs update managed files in a single commit and preserve other repository files. A marker prevents overwriting an unrelated existing repository. Neither app source, release binaries, nor your library/settings are copied. The monorepo's working tree is not committed or pushed by this command.

GitHub's native Pages build handles deployment, so no cross-repository deployment token is stored in Actions. Updates use the local `gh` login. Check deployment progress in the public repository's Pages/Actions UI. GitHub Pages may take several minutes to update after publication.

## Publish downloads

`npm run release -- patch` builds all platforms and stages a draft release in the public app repository, **playlista-app/playlista**. Once the build succeeds, publish the draft from that repository's GitHub Releases page. Alternatively:

```sh
npm run release:publish -- v1.0.3 --dry-run
npm run release:publish -- v1.0.3
```

Replace the example version with the completed release tag. This command checks that every platform build and the checksum manifest are present, then publishes the existing app draft. Draft binaries are visible to maintainers but cannot be downloaded anonymously until the release is published. It does not copy binaries or create a release in the website repository. Existing released tags should not be moved; release a new version for packaging fixes.

The website reads the latest stable published release from **playlista-app/playlista**, selecting Windows setup or Linux AppImage for those platforms. Mac visitors choose Apple Silicon or Intel explicitly; user-agent strings do not reliably identify every Mac processor. All supported platform choices remain available. Mobile visitors receive the complete download list rather than an inappropriate native installer. GitHub and release-note links also point to the app repository.

The browser caches release metadata for five minutes, scoped to the app repository. Empty releases are not cached. A static `releases.json` snapshot is refreshed by site publishing and the optional release-publishing command, so rate-limited/offline GitHub API requests can use the snapshot. When release metadata is unavailable, the main button links to GitHub's latest-release page rather than claiming downloads are still being prepared. AppImage builds named with either `x64` or `x86_64` are recognized. The website never invents a download URL for an unavailable artifact.
