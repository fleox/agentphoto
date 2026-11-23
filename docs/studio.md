# The Studio

The Studio is AgentPhoto's visual editor: a React app (`src/studio/`, built to `dist/studio/`) with a canvas viewport, a tool rail (move, marquee, crop, text, shapes, hand, zoom, eyedropper), a layers panel, an inspector (properties, filters with live parameters and a curve editor, looks, layer effects, masks, canvas settings), AI dialogs (background removal, masks), an export dialog, the templates gallery on the start screen and an optional AI assistant. It previews with the same engine that renders headless for the agent, so what you see is what exports.

```bash
npx -y @fleox/agentphoto@0.1.0 studio --project my-photo
```

`agentphoto studio` serves the Studio on `http://127.0.0.1:4330/` (next free port; `--port`, `--no-open`) with a local REST API over the project folder (contract: [studio-api.md](studio-api.md)). Edits go through the same AI tool catalog as the CLI and the MCP server, so validation is identical. Changes made by another program (an agent in a terminal, a text editor) are pushed to the open Studio and appear live: you can watch your agent work, then take over by hand.

Without the CLI (`npm run dev` in a clone) the Studio keeps projects in the browser (IndexedDB) and runs the engine in the page. The interface is available in English and French.

## Working with an agent

- Ask the agent to open the Studio on the project when you want to finish by hand (skill `agentphoto-publish`), or run the command yourself in another terminal.
- Everything you do is saved to `photo.json`; AI masks are written as new files in `assets/masks/` (and painted edits, when the brush tools land, as new files in `assets/edits/`). Your source photos are never modified.
- The agent reads the document again (`doc summary`) before its next change, so it sees your layers.

## The assistant

The assistant panel runs a tool-use loop with Claude over the same tools (including `render_preview`, whose images it looks at). It calls the Claude Messages API directly from the browser with **your own API key**, stored in the browser's `localStorage` and sent only to `api.anthropic.com`. It is optional; everything else in the Studio works without it, offline.

## AI in the browser

Background removal and Segment Anything masks run in the page (ONNX models through transformers.js, WebAssembly). With `agentphoto studio`, models come from the local cache (`~/.cache/agentphoto/models`) through the server's `/__models/` proxy and are downloaded from Hugging Face only the first time.

## Shortcuts

Tool keys are shown in the tool rail (move `V`, marquee `M`, crop `C`, text `T`, shapes `U`, hand `H`, zoom `Z`, eyedropper `I`); the shortcuts dialog in the Studio lists them all and is the reference.

## Security

The Studio server binds 127.0.0.1 only and rejects requests whose `Host` or `Origin` is not local (DNS rebinding / cross-site protection); project paths cannot leave the folder. See [security.md](security.md).
