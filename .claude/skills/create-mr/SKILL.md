---
name: create-mr
description: Use when the user types `/create-mr`, asks to "open a PR", "create a pull request", "ship this work", "open the PR with what I just did", or any phrase meaning they want to push the current changes of the AgentPhoto repository for review. Walks through a structured auto-review (repo checks + Claude-driven code review with interactive fixes), writes a commit message in the repository's own style, builds an English PR description, and pushes the branch to github.com/fleox/agentphoto. Opens the PR with the `gh` CLI when it is installed and authenticated; otherwise prints a pre-filled GitHub "compare" URL the user clicks once. Asks the user at every destructive step. GitHub-only.
---

# create-mr — auto-review then open a GitHub Pull Request

This skill takes "I've finished a piece of work, ship it" and runs it through the
same checklist a careful colleague would: repo checks, code review, a commit
message in the house style, a structured PR description, issue linking, and
finally the actual push + PR open. Every destructive step is gated by
`AskUserQuestion`. Mirror of Agent3D's `create-mr`
(`../agent-3d/.claude/skills/create-mr/`).

## Prerequisites

- Inside the AgentPhoto repository, `origin` = `https://github.com/fleox/agentphoto.git`
  (default branch **`main`**). `git push` must already work.
- **One of**:
  - `gh` CLI installed and authenticated (`gh auth status`) → fully automated PR creation, OR
  - nothing extra → the skill prints a pre-filled GitHub "compare" URL.
- Dependencies installed (`npm ci`), `python3` for `check:hermes`, an installed
  Chrome / Chromium / Edge / Brave for the render e2e test (it skips without one).

`gh` is installed and authenticated on the maintainer's machine, so expect
`MODE = "gh"`. Most work on this repo lands on `main` directly: use this skill
only when a PR is what the user wants. Never push to `main` from this skill.

## Workflow

### Step 1 — pre-flight

```bash
git rev-parse --is-inside-work-tree
git symbolic-ref --short HEAD
git status --porcelain
git remote get-url origin
command -v gh >/dev/null && gh auth status -h github.com 2>&1
git fetch origin main
```

Capture `currentBranch`, the working-tree state, `<owner>/<repo>` (`fleox/agentphoto`)
and whether `gh` is available + authenticated. `MODE = "gh"` if so, otherwise
`MODE = "compare-url"`. Only Step 11 differs.

Inside an agent worktree (`.claude/worktrees/…`, branch `worktree-agent-…`), say
so and offer to rename the branch to a descriptive name before pushing.

### Step 2 — pick / create the working branch

- `currentBranch !== "main"` → keep it, note `Working on <currentBranch> → target main`.
- `currentBranch === "main"` → infer a **type** (`feat` / `fix` / `chore` /
  `refactor` / `docs` / `test` / `ci`) and a 3–5 word kebab **slug** from the diff,
  then confirm via `AskUserQuestion`:

  ```
  header: "Branch name"
  question: "You're on main. Create a new branch?"
  options:
    - label: "<type>/<inferred-slug> (Recommended)"
      description: "Convention: <type>/<3-5-word-kebab-summary>."
    - label: "Let me type a name"
      description: "I'll provide the branch name in chat."
    - label: "Cancel"
      description: "Abort /create-mr."
  ```

  On approval: `git checkout -b <branch>` (uncommitted changes and local commits
  ahead of `origin/main` follow the branch — mention them).

### Step 3 — handle uncommitted changes

If `git status --porcelain` is non-empty, ask:

```
header: "Uncommitted"
question: "There are uncommitted changes. How do you want to handle them?"
options:
  - label: "Commit them as part of this PR (Recommended)"
    description: "I'll stage everything, run the auto-review, and use a single commit message."
  - label: "Include without auto-committing"
    description: "Stage but don't commit; the user wants to review in another tool first."
  - label: "Cancel"
    description: "Abort /create-mr."
```

Stage with `git add -A` **after** the review fixes (Step 6). `dist/`,
`node_modules/`, `.agentphoto-tmp/`, `.claude/worktrees/`, `coverage/` and `*.log`
are git-ignored; if `git status` shows any of them, or a project's `renders/` /
`dist/` folder, a `photo.json` / `agentphoto.json` outside `templates/`, a user
photo, an `.onnx` model file, or a stray `.mp4` / `.gif` outside `.github/assets/`,
stop and ask.

### Step 4 — collect the diff

```bash
git diff --name-only origin/main...HEAD
git status --porcelain
git diff origin/main...HEAD
git diff
git diff --staged
```

Both outgoing and working files empty → "Nothing to ship." Stop.

### Step 5 — repo checks on what changed

| Changed | Run |
|---|---|
| Any `.ts` / `.tsx` | `npm run typecheck` (app + `tsconfig.agent.json`) |
| `src/`, `agent/`, `scripts/*.test.ts` | `npx vitest run <related test files>`, then `npm test` before shipping |
| `src/core/catalog.ts` | `npx vitest run src/core src/engine/filters src/studio/i18n`, then `UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts` (rewrites `docs/catalog.md`) — see `engine-internals` |
| `src/engine/` (filters, looks, effects, text, compositing) | `npm run build:engine`, re-render the affected templates / recipes and LOOK at them (`pixel-internals`, `content-internals`) |
| `src/engine/ai.ts`, `vite*.config.ts`, `package.json` dependencies | `npm run build`, then `ls dist/engine/ort dist/studio` (only the asyncify ORT pair) and `node dist/agent/agentphoto.mjs doctor --json` |
| `agent/` commands or options | `node scripts/build-cli-docs.mjs` then `--check`; the skills that mention it (`agent-cli-internals`) |
| `agent/`, `plugin/skills/`, `changelog.json`, `package.json`, `README.md`, `docs/` | `npm run build`, then `npm run check:skills` |
| `plugin/skills/`, `hermes/python/` | `npm run hermes:build`, then `npm run check:hermes` — commit the regenerated `hermes/skills/` |
| `library/` | `node scripts/build-library.mjs --check` |
| `templates/` | instantiate each touched template (`new /tmp/t/<id> --template <id>`), `check` and `render` it, look at it (`content-internals`) |
| `src/studio/` | `npx vitest run src/studio`, `npm run build:studio` (`studio-internals`) |

Don't run `npm run build` while another agent is running tests against `dist/`
(build into another folder with `AGENTPHOTO_DIST`, see `agent-cli-internals`).

For each check that reports errors, list the findings and ask whether to fix them
as part of this PR. Say which checks you skipped and why.

### Step 6 — Claude auto-review

Read each modified file with its context and sort findings into five buckets
(see [`reference/review-checklist.md`](reference/review-checklist.md)): Bugs,
Architecture, Style / conventions, Documentation, Security. For each finding:

```
header: "Apply fix?"
question: "<file>:<line> — <one-line summary of the finding>"
options:
  - label: "Apply the proposed fix (Recommended)"
    description: "<short description of what changes>"
  - label: "Skip this finding"
    description: "Leave the code as-is."
  - label: "Discuss in chat"
    description: "Propose a different approach in chat first."
```

Process findings sequentially, then re-run the Step 5 checks for the touched files.

If the diff adds logic without touching tests, ask whether to add a Vitest test
next to the code (`*.test.ts`; `MemoryFs` for ops, a fake `EngineHost` for AI
tools as in `src/ai/tools.test.ts`, `agent/testing/` helpers for CLI behaviour).
Tests are a suggestion, not a blocker — except a new patch op, which
`src/ops/doc.test.ts` requires.

### Step 7 — build the commit message

House style (see [`reference/commit-messages.md`](reference/commit-messages.md)):

```
<Subject: what changed for the user, capitalised, optional "Area: " prefix>

<body — why, and what reviewers must know, wrapped at ~80>
```

e.g. `Firm sticker strokes on soft edges; warn when cover export cuts layers`,
`Docs: Studio painting and selection tools, screenshots`.
Never add `Co-Authored-By: Claude` or a "Generated with Claude Code" line.

Show the draft, then confirm (`Use as-is (Recommended)` / `Let me edit it`).

### Step 8 — related issue

Ask whether the work closes a GitHub issue (`Closes #N` in the PR body) or none.

### Step 9 — build the PR description

Use [`reference/pr-template.md`](reference/pr-template.md), in **English**:
Summary, Motivation, Changes, How to test, Renders, Changelog (user-visible
changes: the `changelog.json` entry under the next version), Related, Risk &
rollback. Attach before / after renders when the change is visual
(`agentphoto render --compare`, exports). Skip sections that don't apply.

### Step 10 — final confirmation

Show source branch → `main`, the full commit message, the PR title (first line)
and body, then ask `Ship it?` (`Yes, ship it (Recommended)` / `Show me the diff
once more` / `Cancel`).

### Step 11 — execute

```bash
git add -A
git commit -m "$(cat <<'EOF'
<full message from Step 7>
EOF
)"
git push -u origin "<currentBranch>"        # never --force
BODY_FILE="$(mktemp "${TMPDIR:-/tmp}/create-mr-body.XXXXXX")"
cat > "$BODY_FILE" <<'EOF'
<full PR body from Step 9>
EOF
```

**MODE = "gh"**:

```bash
gh pr create --repo fleox/agentphoto --base main --head "<currentBranch>" \
  --title "<PR title>" --body-file "$BODY_FILE"
```

Share the printed PR URL. CI (`.github/workflows/ci.yml`) runs on the PR:
`gh pr checks <n> --watch` shows it.

**MODE = "compare-url"**:

```bash
OWNER_REPO=$(git remote get-url origin | sed -e 's|^https://github\.com/||' -e 's|^git@github\.com:||' -e 's|\.git$||')
TITLE_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "<PR title>")
BODY_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(open(sys.argv[1]).read()))" "$BODY_FILE")
echo "https://github.com/${OWNER_REPO}/compare/main...<currentBranch>?expand=1&title=${TITLE_ENC}&body=${BODY_ENC}"
```

### Step 12 — final summary

```
✓ Branch:     fix/export-cover-warning (new) → main
✓ Checks:     typecheck ✓, tests ✓, build ✓, check:skills ✓, check:hermes ✓
✓ Review:     3 findings, 3 applied
✓ Commit:     Warn when a cover export cuts layers
✓ Pushed:     origin/fix/export-cover-warning
✓ PR:         https://github.com/fleox/agentphoto/pull/<n>
```

## Things to never do

- `git push --force`, or a push to `main`.
- `git commit --no-verify` unless the user explicitly chose to skip a failing hook.
- Merge the PR after creating it. The skill **only opens** the PR.
- Run `npm version`, create or push a `v*` tag, or `npm publish`: a `v*` tag publishes to npm.
- Edit `hermes/skills/` by hand (generated), hand-edit the generated parts of `docs/catalog.md` / `docs/cli.md`, or commit `dist/`.
- Commit a user's photo, a project folder, renders or downloaded AI models.
- Add Claude attribution to a commit or PR.
- Edit files unrelated to the diff, or run destructive git operations
  (`reset --hard`, `clean -fd`, `checkout -- <file>` on modified files).

## Reference

- [`reference/review-checklist.md`](reference/review-checklist.md) — what Claude checks, bucket by bucket.
- [`reference/pr-template.md`](reference/pr-template.md) — the PR body template.
- [`reference/commit-messages.md`](reference/commit-messages.md) — subject / body rules and branch names.
