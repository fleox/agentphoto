# Commit messages and branch names (AgentPhoto)

The history uses a short, **capitalised subject** saying what changed, sometimes
with an area prefix (`Docs: …`, `Studio phase 2: …`) and often a parenthesis for
the reason or the detail:

```
<Subject>
<Area>: <subject>

<body — optional: why, and what a reviewer must know>
```

Examples from `git log`:

```
CI and release workflows (npm trusted publishing), releasing doc
Hermes Agent integration: generated skills, Python wrapper and helpers
Ship only the ONNX Runtime WASM variant in use (package 122 MB → 36 MB)
Docs: Studio painting and selection tools, screenshots
Firm sticker strokes on soft edges; warn when cover export cuts layers
Templates (8) with previews and cutout masks; blur fix; subject bbox for AI masks
```

The first commits were large maintainer waves (`Core: …`, `CLI, MCP server, …`);
a PR stays focused on one change.

Never add a `Co-Authored-By: Claude` or "Generated with Claude Code" line.

## Area prefix

Optional; use it when the subject alone does not say where the change is:

| Prefix | What |
|---|---|
| `Engine:`, `Filters:`, `Looks:`, `Text:`, `AI:` | `src/engine/` |
| `Document:`, `Catalog:`, `Check:`, `Export:`, `Assets:` | `src/core/`, `src/ops/` |
| `Tools:`, `MCP:` | `src/ai/`, `agent/mcp/` |
| `CLI:`, `Render:`, `Models:` | `agent/` |
| `Studio:` | `src/studio/` |
| `Templates:`, `Template <id>:`, `Library:` | content |
| `Skills:`, `Hermes:`, `Docs:`, `README:`, `CI:`, `Package:` | distribution |

A feature spanning engine + CLI + docs + skills takes the area the user sees (or
none). Unrelated changes are separate commits. Release commits (the bare version
`0.1.1` written by `npm version`) belong to the maintainer.

## Subject

- What changed, from the user's point of view, present tense, no trailing period.
  A parenthesis, a dash or a semicolon may add the reason or a second related change.
- Aim for ≤ 72 characters; never more than ~120.
- Capitalised first word; names, commands, identifiers and acronyms as written.

## Body

Optional; plain prose wrapped at ~80 characters, the problem before the fix,
user-visible effects, new options / document fields, what a reviewer must test.
`Closes #N` / `Refs #N` at the end.

## Branch names

`<type>/<3-5-word-kebab-summary>` (e.g. `fix/export-cover-warning`). Agent
worktrees create `worktree-agent-<id>` branches: rename them before pushing a PR.

## What to avoid

- Generic subjects: "fix bug", "update files", "wip".
- Describing the request ("as asked…") instead of the change.
- Mixing an unrelated fix into a feature commit.
