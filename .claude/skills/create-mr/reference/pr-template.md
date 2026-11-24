# PR description template

The body written to the temporary body file and passed to
`gh pr create --body-file …` (or URL-encoded into the compare URL). Fill every
applicable section in **English**.

```markdown
## Summary

<1–2 sentences: what this PR does and the user-visible effect.>

## Motivation

<Why this change is needed. Reference the issue or the QA finding.
Explain the problem before the solution.>

## Changes

- <bullet 1: imperative voice — "Add the `dehaze` filter to the catalog and the engine">
- <bullet 2>
- <bullet 3>

## How to test

- [ ] <e.g. `npx vitest run src/ops/check.test.ts`>
- [ ] <e.g. `node dist/agent/agentphoto.mjs new /tmp/x --template og-article --json && node dist/agent/agentphoto.mjs render --project /tmp/x --compare --json`>
- [ ] <expected output / what the render must show>

## Renders

<Visual changes only: before / after renders (`agentphoto render --compare`,
`--zoom` for edges and text) or exports of the affected templates or recipes.>

## Changelog

<The `changelog.json` entry under the next version: user-facing `changes[]`,
and any `actions[]` users must run after updating (update the plugin / skills,
re-export, pull a model…).>

## Related

- Closes #N

## Risk & rollback

<What could break? Document format (DOC_VERSION, normalizeDoc migration)?
Catalog ids or params renamed? Engine bundle or package size (ORT WASM)?
Existing exports looking different? Revert with `git revert <sha>`.>
```

## When to omit sections

| Section | Skip when |
|---|---|
| `Motivation` | the subject line says it all |
| `How to test` | pure docs / typo fix |
| `Renders` | nothing visible changed |
| `Changelog` | nothing user-visible (tests, refactors, contributor docs) |
| `Related` | no linked issue |
| `Risk & rollback` | truly trivial change |

`Summary` and `Changes` are **mandatory**.

## Style rules

- `Changes`: bullets, imperative voice, no trailing period.
- `How to test`: GitHub checkboxes; commands run on scratch projects
  (`/tmp/…`, `.agentphoto-tmp/`) with library photos or CC0 files, never on a
  user's project or photos.
- Precise numbers where the diff allows ("engine entry 412 → 418 KB",
  "package 36 → 37 MB", "export 1.8 s → 0.9 s").

## Never in the PR body

- Personal context, speculation about future work (open an issue instead).
- Tokens (npm, GitHub, Anthropic API keys), credentials, personal data, a user's photos.
- Claude attribution (`Co-Authored-By`, "Generated with Claude Code").
- Long copy-pasted shell sessions — a `<details><summary>` block at most.
