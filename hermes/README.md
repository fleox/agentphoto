# AgentPhoto for Hermes Agent

Skills and Python scripts that let [Hermes Agent](https://hermes-agent.nousresearch.com) (and any agent that prefers Python) retouch photos, cut out subjects with local AI and design visuals with AgentPhoto. The agent opens the photo as a non-destructive project, renders it headless, looks at the images, fixes what it sees and exports.

| Skill | Use it to |
|---|---|
| [`agentphoto-retouch`](skills/agentphoto-retouch/SKILL.md) | open a photo, measure it, fix light and colour, apply looks, retouch portraits, crop / straighten / resize, add text and effects |
| [`agentphoto-cutout`](skills/agentphoto-cutout/SKILL.md) | remove or replace a background with local AI, make packshots on white and stickers, mask with Segment Anything points / box or a colour range |
| [`agentphoto-design`](skills/agentphoto-design/SKILL.md) | YouTube thumbnails, Open Graph images, posts, stories, banners, from templates or size presets, with layout and typography rules |
| [`agentphoto-publish`](skills/agentphoto-publish/SKILL.md) | check, export PNG / JPEG / WebP at platform sizes, several variants at once, light files for the web, hand over to the Studio |

## Install

```bash
hermes skills install fleox/agentphoto/hermes/skills/agentphoto-retouch
```

(Repeat for `agentphoto-cutout`, `agentphoto-design` and `agentphoto-publish`.) Or, from a clone, in `~/.hermes/config.yaml`:

```yaml
skills:
  external_dirs:
    - /path/to/agentphoto/hermes/skills
```

The MCP server works too (tools + `render_preview` returning the render as an image): see [docs/mcp.md](../docs/mcp.md).

## Requirements

- **Python 3.9+**: standard library only.
- **Node.js 22+**: the engine is the [`@fleox/agentphoto`](https://www.npmjs.com/package/@fleox/agentphoto) npm package, run with `npx` and pinned to the version of the skills. `AGENTPHOTO_CMD` overrides it (e.g. `AGENTPHOTO_CMD="node /path/to/agentphoto/dist/agent/agentphoto.mjs"`).
- **Google Chrome, Chromium or Edge** for renders, AI cut-outs and exports (`AGENTPHOTO_CHROME` points at a specific binary). `agentphoto doctor` checks everything.
- AI models (background removal, Segment Anything) download once into `~/.cache/agentphoto/models` (25 to 170 MB). Photos never leave the computer.

## The scripts

Every skill ships `scripts/agentphoto.py`, a dependency-free wrapper of the CLI. It adds `--json`, prints the CLI's JSON object and keeps its exit code:

```python
import sys; sys.path.insert(0, "<skill dir>/scripts")
from agentphoto import run, patch, needs_confirmation, AgentPhotoError

run("new", "my-photo", "--image", "./photo.jpg")
stats = run("analyze", project="my-photo")                       # brightness, cast, suggestions…
run("layer", "add", "--layer", '{"id":"correct","type":"adjustment","filters":[{"type":"vibrance","vibrance":25}]}', project="my-photo")
before, after = run("render", "--compare", project="my-photo")["files"]   # look at these PNGs
patch([{"op": "crop", "x": 0, "y": 0, "width": 1600, "height": 900}], project="my-photo")
files = run("export", "--format", "jpeg", "--quality", "85", project="my-photo")["files"]
```

| Script | Skills | What it does |
|---|---|---|
| `render_and_check.py` | all | Renders the project (`--compare` before / after, `--zoom`, `--layer`), runs `check`, prints the images to look at and a compact verdict. |
| `open_photo.py` | retouch, design | Creates a project from a photo, a template (`--text <layer>=<text>` fills its text layers) or a size preset, runs `analyze`, optionally applies the suggestions as an adjustment layer, renders a first preview. |
| `cutout.py` | cutout | Removes the background with local AI, adds a new background (+ shadow), crops square or tight around the subject, renders the result and a 1:1 zoom on its edge. |
| `export_set.py` | publish | Runs `check`, stops on errors, exports once or as a set of presets (`--presets og,square,story`), lists the files with their weight and notes (upscales, cover crops), asks before overwriting. |

Each prints one JSON object (`{"ok": true, "data": …}`); `--help` lists the options.

## Maintenance (this repository)

`hermes/skills/` is generated: don't edit it. Text comes from [`plugin/skills/`](../plugin/skills), scripts from [`hermes/python/`](python). `npm run hermes:build` regenerates it; `npm run check:hermes` verifies it is up to date and runs the Python tests ([`hermes/tests/`](tests): fake engine, no network, no Node needed).
