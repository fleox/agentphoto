---
name: repo-presentation
description: How the AgentPhoto public presentation is built and kept true — the README (GitHub page and npm page of @fleox/agentphoto, absolute links), the docs/ layout and its index, pinned commands synced by scripts/sync-version.mjs, the images and demos in .github/assets (logo, social preview, how-it-works diagram, showcase stills, templates grid, Studio screenshots, scripted terminal GIFs from VHS tapes in .github/demos, real Claude Code session GIFs, the demo film and its poster), docs/images renders, the Claude Code plugin and marketplace texts, the community files (CONTRIBUTING, SECURITY, issue / PR templates), changelog.json, and the wording rules (PolyForm Noncommercial 1.0.0 = source available, the RMBG-1.4 non-commercial model licence, no hosted service, network claims matching docs/security.md, no planned features, no Claude attribution). Invoke when changing the README, adding or restructuring a page in docs/, adding an image, GIF or film, editing the plugin / marketplace descriptions or a community file, or preparing the public side of a release in this repository.
---

# GitHub and npm presentation — contributor notes (this repo)

Read [CLAUDE.md](../../../CLAUDE.md) and [AGENTS.md](../../../AGENTS.md) ("Docs", "Versions and releases") first. Don't commit or push unless asked. Everything public is in English. Mirror of Agent3D's `repo-presentation` skill (`../agent-3d/.claude/skills/repo-presentation/`): when in doubt, do what it does. Skills content and their checks: [`agent-cli-internals`](../agent-cli-internals/SKILL.md); templates, library, recipes: [`content-internals`](../content-internals/SKILL.md); Studio screenshots' setup: [`studio-internals`](../studio-internals/SKILL.md).

## The README is two pages

`README.md` is both the GitHub page and the npm page of `@fleox/agentphoto` (it is in `package.json → files`). So:

- npm renders it away from the repository. Every link is **absolute**: `https://github.com/fleox/agentphoto/blob/main/…` (files), `https://github.com/fleox/agentphoto/tree/main/…` (folders), `https://raw.githubusercontent.com/fleox/agentphoto/main/…` (images). The default branch is `main`: `blob/master` links are 404s. Only in-page anchors (`#quick-start`) stay relative.
- The README ships with a release: a README **text** fix reaches npm only with the next published version. Images referenced by absolute URL update on both pages with a push to `main`.
- It is a landing page, same shape as Agent3D's: logo + tagline + badges + anchor nav → hero (demo film poster or before / after) → Why → Quick start (Claude Code plugin + prompts + real-session GIFs, other agents, without an agent) → What you can ask / Examples (real before / after renders) → Templates (grid / table of every template with its `preview.jpg`) → How it works (diagram + text) → The Studio (dark screenshots) → CLI (GIFs + command table) → MCP → Privacy → Documentation → Contributing → License. Details belong in `docs/`; link them.
- Numbers in the README (28 filters, 20 looks, 5 layer effects, 16 blend modes, 15 fonts, 13 size presets, 4 AI models, 8 templates, 6 sample photos…) come from the code: re-count with `agentphoto catalog --json`, `agentphoto templates list --json` and `agentphoto assets library --json` when the catalog, templates or library change, and keep `changelog.json` and `docs/` consistent.
- Pinned commands (`npx -y @fleox/agentphoto@x.y.z …`) in the README, `AGENTS.md`, `hermes/README.md` and `docs/*.md` are rewritten by `scripts/sync-version.mjs` at `npm version`; the `version` npm script stages `README.md` and `docs` (not `AGENTS.md`: stage it yourself). `check:skills` fails when the README or docs pin another version. Write them with the **current** version; never an unpinned `npx @fleox/agentphoto` in the README or docs. Run every command you add with the published package outside the repo (`cd /tmp/x && npx -y @fleox/agentphoto@<v> …` — inside the repo, npx resolves the local package).
- The "How it works" picture shows "one engine, four front doors" (CLI, MCP, Studio, assistant → `src/ops` + `src/engine`), the render-and-look loop through headless Chrome and the local model download; keep it in step with `docs/architecture.md`.

## Layout

| Path | Content |
|---|---|
| `docs/README.md` | Index of the documentation (Start here / Reference / Contributors and maintainers): add every new page there |
| `docs/getting-started.md`, `retouching.md`, `studio.md`, `mcp.md` | Start here |
| `docs/document-format.md`, `catalog.md` (generated), `cli.md` (reference generated), `security.md` | Reference |
| `docs/architecture.md`, `studio-api.md` (owned by the CLI), `releasing.md` | Contributors / maintainers |
| `docs/images/` | Real renders used by the README and `docs/retouching.md` (before / after, Studio captures), small JPEGs < 150 KB |
| `hermes/README.md` | The Hermes Agent page (skills table, Python helpers) |
| `.claude-plugin/marketplace.json`, `plugin/.claude-plugin/plugin.json` | Claude Code marketplace (`fleox/agentphoto`) + plugin (`agentphoto`) descriptions; the version lives in `plugin.json` only (the marketplace entry has none, `source: "./plugin"`), `check:skills` enforces it |
| `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md` | Community and maintenance files |
| `changelog.json` | Release notes source (newest first); `release.yml` turns the entry into the GitHub Release |

Generated docs are test inputs: `docs/catalog.md` (`src/ops/docs.test.ts`, `UPDATE_DOCS=1` rewrites it) and the command reference in `docs/cli.md` (`npm run docs:cli`, `npm run check:docs`; `scripts/cli-docs.test.ts` in `npm test`). Don't hand-edit their generated parts.

## Images, demos and the film

Published images live in `.github/assets/` (plus `docs/images/` for docs pages and each template's own `preview.jpg`) and are referenced from the README with absolute `raw.githubusercontent.com/fleox/agentphoto/main/…` URLs; a video is linked through `https://cdn.jsdelivr.net/gh/fleox/agentphoto@main/.github/assets/<file>.mp4` (served with a video content type), so an image fix reaches GitHub **and** the npm page with a push to `main`. Working scripts live in `.github/demos/`: VHS tapes (`<name>.tape`) with the scripts that prepare their throw-away projects from the published package and render them (`setup.sh`, `render.sh <name>`), and `visuals/` (HTML pages for the diagram, the templates grid and before / after cards, plus `shot.mjs`, a small headless-Chrome CDP screenshot driver also used for the Studio). Read a script's header comment before running it; keep new ones in the same place. Typical layout of `.github/assets/`:

| Path | Content |
|---|---|
| `logo.svg`, `logo.png` | The mark |
| `social-preview.png` | 1280×640; the maintainer uploads it in GitHub → Settings → Social preview |
| `how-it-works-{light,dark}.png` | The architecture diagram (an HTML page in `.github/demos/` rendered with headless Chrome), shown with `<picture>` + `prefers-color-scheme` |
| `showcase-<name>.jpg` | Hero stills: real exports of templates and recipes (captions name the template or recipe) |
| `templates-grid.jpg` | Every template's export in one grid |
| `studio-<view>.jpg` | Real Studio screenshots (dark only: the Studio has no light theme) |
| `demo-{cli,render,export,mcp}.gif` | Scripted VHS terminal demos (`.github/demos/*.tape`) |
| `demo-{retouch,cutout,design}.gif` | Real Claude Code sessions, one per main skill |
| `agentphoto-demo.mp4`, `video-poster.jpg` | The demo film and its README poster |

### Stills and the templates grid

Real renders only, never mock-ups or paint-overs: `agentphoto new /tmp/x/<id> --template <id>` (or a recipe applied with `doc apply`) with the **published** package, then `export --format jpeg` at the size the page needs. Look at every image before using it; one crop and ratio per grid; keep JPEGs small (the README loads them all). Before / after pairs come from `render --compare` or two exports.

### Studio screenshots

The published package outside the repo (`cd /tmp/x && npx -y @fleox/agentphoto@<v> studio --project <dir> --port <free> --no-open`), a project created from a template or a library photo, headless Chrome over the DevTools protocol at a fixed CSS viewport (e.g. 1440×900, deviceScaleFactor 2), downscaled JPG. Deep-link params set the state (`?select=<id>&panel=filters|looks|effects&tool=<tool>&dialog=export&events=0`). Dark only. Nothing personal on screen (no API key in the assistant panel, no `/Users/…` paths, no model-consent dialog unless that is the point).

### Terminal demos

`vhs`, `ttyd`, `ffmpeg`, `jq` (Homebrew). One look for every tape (window size, padding, font size, theme, prompt), setup hidden. Tapes run the **published** CLI in a throw-away folder; renders and exports inside a tape are real (headless Chrome), and a tape that removes a background downloads the model on first run: warm the cache (`models pull`) in the hidden setup. Re-render after a release that changes the output, then push (the README picks it up immediately).

### Real agent sessions

Recorded once with VHS around a real `claude` run in a clean folder (`claude --setting-sources project,local`, the plugin enabled in that folder's `.claude/settings.json`), with a library photo or a CC0 file, then composed: real time until the prompt is sent, the agent's work sped up with a **visible ×N label**, the answer held, ending on the result (the exported image). README captions say "a real Claude Code session" and that the work is sped up; never present sped-up footage as real time. No tokens, account names or `/Users/…` paths on screen.

### The demo film

Built like Agent3D's: a local TTS voice with a pronunciation dictionary for names and acronyms (AgentPhoto, CLI, MCP, AI, JSON, PNG, WebP, AVIF, CC0, RMBG…), Chrome-rendered title cards, real exports, Studio footage recorded over CDP with a drawn cursor, the real agent sessions, burned-in subtitles, assembled with ffmpeg (1920×1080, H.264 + AAC, faststart, kept small enough for the repository). The working files are not in the repo; the result is `.github/assets/agentphoto-demo.mp4` with `video-poster.jpg`. If the owner uploads it to YouTube, point the README poster at the YouTube URL.

## Writing rules

- Say what the product does today; describe nothing planned. Every feature claim must be checkable in the code, `docs/` or `agentphoto catalog`; every command must run with the published package; check the Studio source before describing a Studio tool.
- The licence is **PolyForm Noncommercial 1.0.0**: say "source available", never "open source"; commercial use needs written authorization from the maintainer.
- **RMBG-1.4**, the default background-removal model, is licensed by BRIA AI for **non-commercial** use (`bria-rmbg-1.4`); MODNet, SlimSAM and SAM are Apache-2.0. Wherever background removal is pitched for products or business, say so and point to `--model modnet` (people), Segment Anything masks, or a BRIA licence — as `docs/security.md` does.
- No hosted service: never describe an AgentPhoto server, account, cloud, upload or subscription. The public site [www.photo-touch-up.fr](https://www.photo-touch-up.fr/) is the Studio as **static files** (projects in the browser, engine and AI in the page): describe it that way ([`site/README.md`](../../../site/README.md), `docs/security.md` "The online Studio"); its guide (`site/content/`) follows these same rules. Exception: that site (and only it) loads Google Analytics (`GA_ID` in `site/render.mjs`); every text about it must say so, and "no analytics" claims apply to the product (npm package, CLI, MCP, local Studio) only. The network claims must match `docs/security.md` exactly: the one-time model download from huggingface.co (cached in `~/.cache/agentphoto/models`), images the user asked to fetch by URL, `npx` fetching the package, and the optional Studio assistant (api.anthropic.com with the user's own key). Photos never leave the computer; no telemetry, CDN, web fonts or analytics.
- Fonts are OFL (Roboto Slab Apache-2.0) and the sample photos CC0: usable in commercial images. Don't extend that claim to the model.
- Comparisons (Photoshop, Canva, online background removers, hand-written scripts) stay factual and fair: what each one is good for, no disparagement.
- Requirements: Node.js 22+ (`engines`), Chrome / Chromium / Edge / Brave for renders and exports.
- No Claude attribution anywhere (commits, PRs, docs, release notes). The film and the GIFs may show Claude Code being used; that is the product's use case, not an attribution.

## Checks before handing over

```bash
npm run build && npm run check:skills      # README / docs pins, plugin and marketplace manifests
node scripts/build-cli-docs.mjs --check
npx vitest run src/ops/docs.test.ts scripts/cli-docs.test.ts
grep -n "github.com/fleox/agentphoto/blob/master\|](docs/\|](\./" README.md   # must print nothing: absolute links only
```
