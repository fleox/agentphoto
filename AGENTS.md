# AGENTS.md — maintenance rules for AI agents working on AgentPhoto

Read `CLAUDE.md` first (architecture, hard rules, contracts). This file lists what must stay in sync when you change something.

## One engine, four front doors

- Business rules live in `src/ops/` only; pixels in `src/engine/`. The Studio (`src/studio/`), the CLI (`agent/commands/`), the MCP server (`agent/mcp/`) and the Studio assistant call ops / AI tools — never re-implement a rule in a command or a page.
- AI tools are declared once in `src/ai/tools.ts`. MCP `tools/list`, `agentphoto tools list|call`, the Studio API (`/api/tools`) and the assistant expose exactly that list. A new tool needs a precise description, a JSON schema, `mutating` set right (`mcp --read-only` depends on it) and `needsEngine` when it needs pixels; mention it in `docs/mcp.md` and in the skill that uses it.

## The catalog is declared once

`src/core/catalog.ts` → validation (`src/core/validate.ts`), the engine's filter registry (`src/engine/filters/`), AI tools (`catalog_get`), the Studio pickers and `docs/catalog.md`.

- Adding a filter, look, layer effect, font, size preset or AI model means: the catalog entry (params with types, ranges, defaults), its engine implementation (the registry parity test fails otherwise), and regenerating `docs/catalog.md` (`src/ops/docs.test.ts` fails when it is stale).
- Skills and docs never list parameters by heart beyond examples: they send agents to `agentphoto catalog`. When you rename or remove a catalog id or parameter, grep `plugin/skills/`, `docs/` and `README.md` for it.

## The document format is a contract

`src/core/types.ts` changes are additive. When a field is added: `docs/document-format.md` (prose + example), the relevant skill reference (`agentphoto-retouch/references/patch-ops.md`, `recipes.md`…), and the Studio inspector if it should be editable. A breaking change bumps `DOC_VERSION` (copied into `dist/version.json` as `docVersion`) and needs a migration in `normalizeDoc`.

## Skills follow the code

- `plugin/skills/` is the single source of the agent skills: `agentphoto-retouch` (core: open, analyze, correct, looks, portrait, geometry, text, check, export), `agentphoto-cutout` (background removal, masks), `agentphoto-design` (templates, size presets, typography, layout), `agentphoto-publish` (export formats, sizes, variants, web weight, the Studio). When a CLI command, option, output field, error code or default changes, update every skill / reference that mentions it **in the same change**.
- `npm run check:skills` (after the build) fails when a skill calls a command, action or **option** missing from `help --json`, pins another version than `package.json`, uses non-portable frontmatter, contains non-English prose, links to a missing file, has an invalid ```json block, contains a full document example (`"version"` + `"layers"`) that fails `agentphoto doc validate` (errors or warnings), or when README / docs pin another version.
- Skills are 100% English; agents translate for the user at runtime.
- Commands in skills are always pinned: `npx -y @fleox/agentphoto@0.1.2 <command> --json` (rewritten by `scripts/sync-version.mjs`).
- Every command written in a skill must have been run for real, in order, on a scratch project. Every document in `agentphoto-retouch/references/recipes.md` was validated, applied, checked and rendered: re-render the recipes after engine changes that affect looks (filters, looks, text, effects, compositing) and update them if they no longer look right.

## Hermes is generated

- `hermes/skills/` is generated from `plugin/skills/` + `hermes/python/` by `npm run hermes:build` (`scripts/build-hermes.mjs`): commands become `python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py …`, a "Running the commands (Hermes)" section is inserted, the Python files are version-pinned. Never edit it by hand; regenerate and commit with the skill change.
- `npm run check:hermes` fails when it is stale and runs the Python tests (`hermes/tests/`, fake engine, stdlib only, no Node).
- Python helpers stay stdlib-only, Python 3.9+, print one JSON object, and take `--project` (or the new folder). A new helper: add it to `HELPERS` in `scripts/build-hermes.mjs`, describe it in its docstring's first line (it becomes the skill's helper list) and in `hermes/README.md`, and test it in `hermes/tests/test_scripts.py`. A CLI output field a helper reads (`render` → `files`, `info` → `summary.canvas`, `remove-bg` → `subject`, `export` → `files[].note`…) is a contract: change the helper and its test with it.

## CLI contract

- `--json` → exactly one `{ ok, data }` or `{ ok: false, error: { code, message, hint } }` on stdout; logs on stderr. Exit 0 ok, 1 failure, 2 usage / validation.
- Destructive or overwriting commands print `{ needsConfirmation: true, plan }` unless `--yes`.
- Every error a user can hit has a `hint`.
- New command, action or option: `agent/commands/` (`usage`, `summary`, `options`, `subcommands`), a test, then `node scripts/build-cli-docs.mjs` (regenerates the reference in `docs/cli.md`; `scripts/cli-docs.test.ts` fails when it is stale) and the relevant skill.

## Versions and releases

- `package.json` version = `plugin/.claude-plugin/plugin.json` version = every skill's `metadata.version` = every pinned `@fleox/agentphoto@x.y.z` (skills, docs, README, this file). `node scripts/sync-version.mjs` rewrites them all; `npm version patch|minor|major` runs it (with the build and the CLI docs).
- `.claude-plugin/marketplace.json` never carries a version (plugin.json wins silently); its plugin `source` is `./plugin`.
- `scripts/write-version.mjs` (run by `npm run build`) writes `dist/version.json` (`version`, `minSkillsVersion` from `package.json → agentphoto.minSkillsVersion` or the version, `docVersion`).
- Every release has a `changelog.json` entry (newest first) with `version`, `date`, `breaking`, `changes[]` and `actions[]`.

## Docs

- `docs/catalog.md` is generated (catalog), `docs/cli.md`'s reference section is generated (CLI), `docs/studio-api.md` is owned by the CLI (`agent/commands/serve.ts`). Everything else in `docs/` is hand-written: keep it true when behaviour changes (output paths, defaults, network use, licences).
- `docs/images/` holds real renders used by the README and `docs/retouching.md` (small JPEGs, < 150 KB): regenerate them from the recipes with `agentphoto render` / `export` rather than editing images. The README uses absolute `raw.githubusercontent.com` URLs so the npm page shows them.

## Tests

- `npm test` (Vitest, next to the code; `scripts/*.test.ts` included) — never touches the network (inject `fetch`), never needs Chrome (render e2e tests skip without `dist/engine` / a browser).
- `npm run typecheck`, `npm run build`, `npm run check:skills`, `npm run check:hermes` (needs `python3`), `node scripts/build-cli-docs.mjs --check`.
