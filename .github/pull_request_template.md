## What and why

<!-- What does this change, and which issue does it address? -->

## Checklist

- [ ] Business rules live in `src/ops/` and pixels in `src/engine/` (not in a page or a command), with Vitest tests next to the code; tests never touch the network
- [ ] `npm run typecheck`, `npm run build`, `npm test`, `npm run check:skills`, `npm run check:hermes` and `npm run check:docs` pass
- [ ] Catalog changes have an engine implementation, Studio labels (`en` + `fr`) and a regenerated `docs/catalog.md`
- [ ] Nothing uploads photos or calls a third-party service (only the one-time model download and user-given URLs)
- [ ] Edits stay non-destructive: source files untouched, new files for masks and painted pixels
- [ ] New Studio strings in `en` and `fr`
- [ ] Skills in `plugin/skills/` and `docs/` updated if the CLI, the AI tools, the document format or the Studio's behaviour changed
- [ ] Visual changes: affected templates and recipes re-rendered and looked at (before / after attached)
- [ ] `changelog.json` entry for user-visible changes
