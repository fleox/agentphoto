# The public site — www.photo-touch-up.fr

The Studio, usable online without installing anything, plus a guide in English and French that presents it and points to AgentPhoto for agents. Everything is built from this repository; the GitHub Pages repository [`fleox/photo-touch-up.fr`](https://github.com/fleox/photo-touch-up.fr) only holds the built files.

| URL | Content | Source |
|---|---|---|
| `/` | The Studio in local mode: projects in the browser (IndexedDB), engine and AI in the page | `dist/studio` (standalone `vite build`, with ONNX Runtime in `ort/`) + SEO tags from `render.mjs` |
| `/guide/`, `/fr/guide/` | The guide: features with screenshots, step-by-step tasks, the agent version, FAQ | `content/en.mjs`, `content/fr.mjs` → `render.mjs` |
| `/config.js` | `guideUrl` for the Studio's start screen ("Guide" link) | `scripts/build-site.mjs` |
| `/site/` | `style.css`, Inter (from `library/fonts`), screenshots (`img/<lang>/`), the demo film, the Open Graph image, the diagram | this folder + `.github/assets/` |
| `404.html`, `robots.txt`, `sitemap.xml`, `CNAME`, `.nojekyll` | GitHub Pages and crawlers | `scripts/build-site.mjs` |

## Build and preview

```bash
npm run build:site                      # vite build (standalone Studio) + scripts/build-site.mjs → dist/site/
cd dist/site && python3 -m http.server 8765 --bind 127.0.0.1
```

`npm run build:site` replaces `dist/studio` with the standalone build (ONNX Runtime included); `npm run build` brings back the npm package's build.

## Deploy

`.github/workflows/site.yml` runs on every `v*` tag (next to the npm release) and by hand (Actions → Site → Run workflow): typecheck, the site and Studio tests, `npm run build:site`, then it replaces the content of `fleox/photo-touch-up.fr` and pushes. GitHub Pages serves that repository's `main` branch at `www.photo-touch-up.fr`.

- The push uses a deploy key: its public half is a **write** deploy key of `fleox/photo-touch-up.fr`, its private half the secret `SITE_DEPLOY_KEY` of this repository.
- DNS (Cloudflare): `www` is a CNAME to `fleox.github.io`; the apex redirects to `www`.

## Writing the guide

- Same rules as the README ([`repo-presentation`](../.claude/skills/repo-presentation/SKILL.md) "Writing rules"): describe what the Studio served by this site does today, check every claim in the code (labels come from `src/studio/i18n/`), source available under PolyForm Noncommercial 1.0.0, the RMBG-1.4 non-commercial licence, network claims matching [docs/security.md](../docs/security.md).
- `en.mjs` and `fr.mjs` have the same keys and lists; `scripts/site.test.ts` checks it, the screenshots and the wording.
- The agent command is pinned to the package version at build time.

## Screenshots

`img/<lang>/<name>.jpg`, 1600×1000, taken from the built site itself (local mode) in English and French:

```bash
# real projects made with the CLI (names used by site/screenshots.mjs)
ap() { node dist/agent/agentphoto.mjs "$@"; }
cd /tmp/shots
ap new thumb --template youtube-thumbnail --title "YouTube thumbnail"
ap new product --template product-white --title "Mug packshot"
ap new sale --template sale-banner --title "Summer sale"
ap new lake --image <repo>/library/images/landscape.jpg --title "Lake at dawn"   # + exposure, curves, vibrance, clarity
ap new city --image <repo>/library/images/city.jpg --title "Lisbon street"        # + look film
ap new cat --image <repo>/library/images/pet.jpg --title "Cat portrait"
# the built site served on 8765 (above), then:
node site/screenshots.mjs --projects /tmp/shots [--only ai-select] [--lang fr]
```

The script imports each project through `#import`, sets the view with the deep-link params and captures headless Chrome at 1440×900 ×2. `ai-select` runs Segment Anything in the page (downloads SlimSAM, 30 MB, from Hugging Face). Look at every image before committing it; nothing personal on screen.
