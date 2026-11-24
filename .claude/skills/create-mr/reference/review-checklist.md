# Auto-review checklist (AgentPhoto)

What Claude looks for during Step 6 of `/create-mr`. Findings are sorted into
five buckets; each finding becomes a single `AskUserQuestion`. The hard rules and
contracts are in [CLAUDE.md](../../../../CLAUDE.md); what must stay in sync is in
[AGENTS.md](../../../../AGENTS.md). Area details: the `*-internals` skills.

## 1. Bugs

- **Pure render**: the render is a function of (document, files, fonts). No
  `Math.random()` or clock in `src/engine/`; noise and other randomness from a
  seed (`mulberry32`). Preview, export, the Studio and headless Chrome must give
  the same pixels.
- **Scale**: every distance (catalog params with `px: true`, effect blur /
  distance / spread / stroke, mask feather, shape masks) multiplied by the render
  scale, so a 50 % preview matches the export; `resizeImage` scales it too.
- **Alpha**: filters keep alpha and work on straight RGBA; masks are luminance ×
  alpha, white = keep; box-layer masks in layer px, fill / group masks in canvas px.
- **Cache**: anything that changes a layer's pixels is in the layer JSON or in the
  compositor cache key; a file rewritten under the same name is invalidated.
- `applyDoc` / `patchDoc` never write an invalid document (errors → `applied: false`);
  a failing patch op throws with `details.opIndex`; same input twice → empty plan.
- Non-destructive: source images never modified; painted pixels and masks are
  **new** files in `assets/edits/` / `assets/masks/`.
- CLI: `--json` prints exactly one object, logs on stderr, exit 0 / 1 / 2;
  destructive or overwriting commands answer `needsConfirmation` unless `--yes`.
- Headless engine: every CDP wait has a timeout (`AGENTPHOTO_CDP_TIMEOUT_MS`),
  Chrome and its temp profile are closed / removed on every exit path; a new
  engine method exists in `headless.ts`, the session and `pageEngineHost`.

## 2. Architecture

- **One engine, four front doors**: a rule in a command, the MCP server, a Studio
  component or the assistant instead of `src/ops/` (business) or `src/engine/` (pixels).
- **Catalog declared once** (`src/core/catalog.ts`): every filter / look has an
  engine implementation (`src/engine/filters/registry.test.ts`), params with
  types / ranges / defaults, Studio labels in en + fr; `docs/catalog.md` regenerated.
- **AI tools declared once** in `src/ai/tools.ts`; `mutating` (`mcp --read-only`)
  and `needsEngine` correct; MCP annotation sets updated.
- `src/ops/` and `src/core/` stay pure TS over `ProjectFs`: no DOM, no Node APIs,
  network only through an injected `fetch`.
- Contracts (`src/core/types.ts`, `src/core/catalog.ts`, `src/ai/types.ts`,
  `src/engine/index.ts`) change additively; a breaking document change bumps
  `DOC_VERSION` with a migration in `normalizeDoc`.
- The CLI bundle never imports transformers.js / onnxruntime / `src/engine/ai.ts`
  (types only); AI code stays lazy in the engine; only the asyncify ORT WASM pair ships.
- No new runtime dependency without the maintainer's go (the npm package inlines everything).

## 3. Style / conventions

- `strict` TypeScript, no needless `any`, domain types from `src/core/types.ts`.
- Code matches the surrounding naming, comment density and idiom.
- Errors a user can hit carry an actionable `hint` (`OpsError`, `CliError`);
  hints in ops name AI tools (the CLI rewrites them through `TOOL_COMMANDS`).
- Studio: strings through `t()` with en + fr keys, Tailwind tokens (dark only),
  logic in `lib/` with tests rather than in `.tsx`.
- Dead code, unused imports, magic numbers without a name.

## 4. Documentation

- Comments in English, only when the *why* is non-obvious.
- **Skills follow the code**: a changed command, option, output field, document
  field or catalog id updates `plugin/skills/` in the same change, then
  `npm run hermes:build`; commands in skills are pinned and were run for real.
- New command / option: `agent/commands/`, `node scripts/build-cli-docs.mjs`, a test.
- Document field: `docs/document-format.md` and the skill references; AI tool:
  `docs/mcp.md`; Studio API route: `docs/studio-api.md`; network use or licence:
  `docs/security.md`.
- User-visible change: a `changelog.json` entry under the next version.
- README numbers / tables when catalog, templates or library change
  (`repo-presentation`); README links absolute.

## 5. Security and privacy

- Photos never leave the computer: no upload, no telemetry, no CDN, no web fonts;
  the only network is the one-time model download (through `/__models/` under the
  CLI), URLs the user gave (`assets add --url`), and the optional assistant
  (api.anthropic.com with the user's key).
- The local servers (render server, `studio`) bind 127.0.0.1; `localGuard` stays
  first; files are never served outside the project / dist / library / model
  cache roots (path traversal, symlinks — `NodeFs`, `resolveUnder`, `parseModelPath`).
- Imported files: size limit (`MAX_ASSET_BYTES`), safe names (`safeFileName`),
  extension matching the real image type.
- Licences: new library content CC0 / OFL with provenance in `library/LICENSES.md`;
  the RMBG-1.4 non-commercial model licence stays visible where it applies.
- No token, credential, personal data or user photo in code, fixtures, logs or
  `--json` output.

## Severity grading

- **Critical** — actively broken or dangerous. Default to "Apply".
- **Major** — design issue that will hurt soon. Default to "Apply".
- **Minor** — style nit, missing comment. Batch at the end.

Always show the finding's line + the proposed fix in chat before asking.
