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

Push changes under `website/` to **main** in the app repository. The **Website** GitHub Actions workflow validates and builds the site, updates the Pages repository, and GitHub Pages deploys it automatically. Publishing an app release refreshes the static download snapshot too. App-only changes do not redeploy the website.

The workflow also runs when its deployment/build scripts change. Use **Actions → Website → Run workflow** on main to redeploy manually. Deployments are serialized, and unchanged output is skipped. It always publishes from main, including when triggered by a release tag.

The cross-repository push uses an SSH deploy key that can write only to `playlista-app/playlista-app.github.io`. Its private key is stored in the app repository's `WEBSITE_DEPLOY_KEY` Actions secret. The workflow's built-in GitHub token has read-only access; no personal access token is stored in Actions.

Maintainers can configure that key once, or recover it if it is removed, with an authenticated GitHub CLI account that administers both repositories:

```sh
npm run site:setup -- --dry-run
npm run site:setup
```

The setup command generates the key in a temporary directory, uploads the public key to the Pages repository, stores the private key directly in the Actions secret, and removes the temporary files. It does not replace an existing working configuration.

GitHub disables deploy keys by default for new organizations. If setup reports **Deploy keys are disabled for this repository**, an organization owner must enable them under **Organization Settings → Member privileges → Deploy keys**. This is an organization policy, so the setup script does not change it automatically. See [GitHub's deploy-key policy documentation](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-organization-settings/restricting-deploy-keys-in-your-organization).

The maintainer's local GitHub CLI login also needs the `workflow` permission to push new workflow files. If GitHub rejects the workflow push, use `gh auth refresh -h github.com -s workflow`, authorize the permission update, and retry the push. This permission is for installing/updating workflows; it is not a personal token stored in Actions.

Local previews and builds use `npm run site:preview` and `npm run site:build`. The latter writes generated files to ignored `build/website/`. The same preparation code is used for automatic and manual deployment.

For a manual deployment from your computer, your authenticated GitHub CLI account can still run:

```sh
npm run site:publish -- --dry-run
npm run site:publish
```

On its first run, the publisher creates the public organization site repository, uploads only the files under `website/`, and enables GitHub Pages from the root of its default branch. Subsequent runs update managed files in a single commit and preserve other repository files. A marker prevents overwriting an unrelated existing repository. Neither app source, release binaries, nor your library/settings are copied. The monorepo's working tree is not committed or pushed by this command.

The workflow pushes over SSH using the repository-limited deploy key, which triggers GitHub's native Pages build. Check the **Website** workflow in the app repository and the **pages build and deployment** workflow in the Pages repository. GitHub Pages may take several minutes to update after publication.

## Publish downloads

`npm run release -- patch` builds all platforms and stages a draft release in the public app repository, **playlista-app/playlista**. Once the build succeeds, publish the draft from that repository's GitHub Releases page. Alternatively:

```sh
npm run release:publish -- v1.0.3 --dry-run
npm run release:publish -- v1.0.3
```

Replace the example version with the completed release tag. This command checks that every platform build and the checksum manifest are present, then publishes the existing app draft. Draft binaries are visible to maintainers but cannot be downloaded anonymously until the release is published. It does not copy binaries or create a release in the website repository. Existing released tags should not be moved; release a new version for packaging fixes.

The website reads the latest stable published release from **playlista-app/playlista**, selecting Windows setup or Linux AppImage for those platforms. Mac visitors choose Apple Silicon or Intel explicitly; user-agent strings do not reliably identify every Mac processor. All supported platform choices remain available. Mobile visitors receive the complete download list rather than an inappropriate native installer. GitHub and release-note links also point to the app repository.

The browser caches release metadata for five minutes, scoped to the app repository. Empty releases are not cached. A static `releases.json` snapshot is refreshed by site publishing and the optional release-publishing command, so rate-limited/offline GitHub API requests can use the snapshot. When release metadata is unavailable, the main button links to GitHub's latest-release page rather than claiming downloads are still being prepared. AppImage builds named with either `x64` or `x86_64` are recognized. The website never invents a download URL for an unavailable artifact.
