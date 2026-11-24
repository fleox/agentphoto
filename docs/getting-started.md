# Getting started

AgentPhoto is meant to be driven by an AI agent, but every step is a plain command you can run yourself. You need **Node.js 22+** and **Google Chrome** (or Chromium / Edge / Brave): previews, exports and the local AI run in it, headless.

```bash
npx -y @fleox/agentphoto@0.1.1 doctor
```

`doctor` checks Node, finds your browser, the engine and Studio builds, the library, the templates and the AI model cache, and renders a test image headless. It exits 1 when a required check fails, with a hint per failed check.

## With an agent

**Claude Code** — install the skills, then just ask:

```text
/plugin marketplace add fleox/agentphoto
/plugin install agentphoto@agentphoto
```

> Here is `~/Desktop/mug.jpg`: cut the mug out, put it on white with a soft shadow, square, for my shop.

The skills (`agentphoto-retouch`, `agentphoto-cutout`, `agentphoto-design`, `agentphoto-publish`) open the photo as a project, edit it, render it and **look at the render**, fix what they see, run `check` and export.

**Claude Desktop, Cursor, any MCP client** — see [mcp.md](mcp.md). **Hermes Agent** skills (Python) — see [`hermes/`](../hermes). **Other agents** (Codex, Windsurf…): point them at [AGENTS.md](../AGENTS.md) and the Markdown skills in [`plugin/skills/`](../plugin/skills).

## By hand, in six commands

```bash
npx -y @fleox/agentphoto@0.1.1 new trip --image ./lake.jpg
npx -y @fleox/agentphoto@0.1.1 analyze --project trip
```

`new` copies the photo into `trip/assets/images/`, makes it the layer `photo` and sizes the canvas to it. `analyze` measures it (brightness, tonal range, clipping, colour cast, saturation, sharpness) and suggests filters. Correct it with an adjustment layer and look:

```bash
npx -y @fleox/agentphoto@0.1.1 layer add --project trip --layer '{"id":"correct","type":"adjustment","filters":[{"type":"levels","black":20,"white":235},{"type":"vibrance","vibrance":20},{"type":"look","look":"film","amount":0.5}]}'
npx -y @fleox/agentphoto@0.1.1 render --project trip --compare
```

Open `trip/renders/preview-before.png` and `trip/renders/preview.png` side by side. Then check and export:

```bash
npx -y @fleox/agentphoto@0.1.1 check --project trip
npx -y @fleox/agentphoto@0.1.1 export --project trip --format webp --quality 82
```

The image is in `trip/dist/`. Nothing was uploaded and `assets/images/lake.jpg` is untouched: every change is data in `trip/photo.json`, which you can edit, diff or keep in git.

## Next

- Remove a background: `npx -y @fleox/agentphoto@0.1.1 remove-bg photo --project trip --background "#ffffff"` (the AI model downloads once, then runs offline).
- Start from a template: `npx -y @fleox/agentphoto@0.1.1 templates list`, then `new thumb --template youtube-thumbnail --image ./me.jpg`.
- Finish by hand in the visual editor: `npx -y @fleox/agentphoto@0.1.1 studio --project trip` ([studio.md](studio.md)).
- Recipes: [retouching.md](retouching.md); the format: [document-format.md](document-format.md); every command: [cli.md](cli.md).
