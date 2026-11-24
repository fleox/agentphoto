# Releasing

The package is published to npm as [`@fleox/agentphoto`](https://www.npmjs.com/package/@fleox/agentphoto). `dist/` is not committed: every publish builds it.

## Each release

1. Make sure `main` is green: `npm run typecheck`, `npm test`, `npm run build`, `npm run check:skills`, `npm run check:hermes`, `node scripts/build-cli-docs.mjs --check`.
2. Add the release to `changelog.json` (newest first): `version`, `date`, `breaking`, `changes[]` (user-facing), `actions[]` (what users must do after updating).
3. If older skills no longer work with this CLI, set `"agentphoto": { "minSkillsVersion": "x.y.z" }` in `package.json` (`scripts/write-version.mjs` copies it into `dist/version.json`; default: the release version).
4. `npm version patch|minor|major`. The `version` script syncs everything that repeats the version (`scripts/sync-version.mjs`: plugin.json, skills' `metadata.version`, every pinned `@fleox/agentphoto@x.y.z` in skills, docs and READMEs), builds, regenerates `hermes/skills` and `docs/cli.md`, and stages them in the version commit.
5. Push the commit and the tag: `git push && git push --tags`. The **Release** workflow (`.github/workflows/release.yml`) runs every check, smoke-tests the packed tarball, publishes to npm with provenance through **npm trusted publishing** (OIDC: no npm token is stored in GitHub) and creates the GitHub Release from the `changelog.json` entry. It is idempotent: a version already on npm is skipped.

The same tag runs the **Site** workflow (`.github/workflows/site.yml`): it builds the online Studio and its guide and pushes them to the GitHub Pages repository `fleox/photo-touch-up.fr` (www.photo-touch-up.fr). Run it by hand (Actions → Site → Run workflow) to publish a guide fix between releases. See [site/README.md](../site/README.md).

Every push to `main` and every pull request also runs the **CI** workflow (`.github/workflows/ci.yml`): typecheck, build, tests, skills, Hermes, CLI docs, library index, CLI smoke test, `npm pack --dry-run`.

### One-time setup

- The first version (0.1.0) is published by hand from a terminal: `npm publish` (`prepublishOnly` runs typecheck, tests, build and `check:skills`). npm only allows trusted publishing on an existing package.
- Then on npmjs.com → package `@fleox/agentphoto` → **Settings → Trusted Publisher**: GitHub Actions, organization/user `fleox`, repository `agentphoto`, workflow file `release.yml`, no environment.

The package ships `dist/agent`, `dist/engine`, `dist/studio`, `dist/index.html`, `library`, `templates`, `plugin`, `changelog.json`, `README.md`, `LICENSE`.

## What users do

- Claude Code: `/plugin marketplace update agentphoto`, then `/reload-plugins` (the skills pin the new version, so `npx` fetches it).
- Hermes: `hermes skills update` (or re-install from `hermes/skills`).
- MCP configs pin a version in their `args`: update it.
