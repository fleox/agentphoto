# Contributing to AgentPhoto

Thanks for helping! AgentPhoto is source-available under the PolyForm Noncommercial license; by contributing you agree your contribution is licensed the same way.

## Setup

```bash
npm ci
npm run dev              # the Studio in your browser (projects kept in IndexedDB)
npm run typecheck
npm run build            # dist/engine + dist/studio + dist/agent/agentphoto.mjs + dist/version.json
npm test                 # Vitest; the render e2e test uses dist/engine and your Chrome (skipped when missing)
npm run check:skills     # after the build
npm run check:hermes     # needs python3
npm run check:docs       # docs/cli.md is generated from `help --json`
node scripts/build-library.mjs --check
```

To try the CLI you just built: `node dist/agent/agentphoto.mjs doctor`. Renders and exports need Node.js 22+ and Chrome, Chromium, Edge or Brave. Background removal and AI masks download their model once from Hugging Face into `~/.cache/agentphoto/models`; the tests never do.

## Rules of the road

- Read `CLAUDE.md` (architecture and hard rules) and `AGENTS.md` (what must stay in sync).
- Business logic goes in `src/ops/` with Vitest tests next to it; pixels in `src/engine/`; the Studio in `src/studio/`; the CLI and the MCP server in `agent/`.
- The catalog (`src/core/catalog.ts`) and the AI tools (`src/ai/tools.ts`) are declared once. A new filter or look needs its engine implementation, Studio labels in `en` and `fr`, and a regenerated `docs/catalog.md` (`UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts`).
- Local only: no server, no account, no upload. Photos never leave the computer; the only network use is the one-time AI model download and images the user asks to fetch by URL. No CDN, web fonts or analytics. Tests never touch the network (inject `fetch`).
- Documents are data and edits are non-destructive: source files are never modified, painted pixels and masks are new files in `assets/`. The render is a pure function of the document, its files and the fonts.
- New built-in content must allow redistribution and commercial use of the images made with it: CC0 photos, OFL fonts, with the provenance recorded in `library/index.json` and `library/LICENSES.md`.
- English everywhere in code, docs and skills; Studio strings in `en` and `fr`.
- Keep the CLI JSON contract (one object on stdout, hints on errors, plans before destructive changes).
- No new runtime dependency without discussing it first (the npm package inlines everything it needs).

## Pull requests

- One topic per PR, with tests. CI runs typecheck, build, tests, `check:skills`, `check:hermes`, the CLI docs check, the library index check, a CLI smoke test and `npm pack --dry-run`.
- If you change a command or an AI tool, update `docs/cli.md` (`npm run docs:cli`), `docs/mcp.md`, the skills in `plugin/skills/`, and regenerate Hermes (`npm run hermes:build`).
- If you change how things are drawn, re-render the templates and the recipes you affect and look at them; re-export a template's `preview.jpg` when it changes.
- Attach before / after renders (`agentphoto render --compare`) for visual changes.
- Describe user-visible changes; maintainers add them to `changelog.json` at release time.
