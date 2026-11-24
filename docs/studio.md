# The Studio

The Studio is AgentPhoto's visual editor: a React app (`src/studio/`, built to `dist/studio/`) with a canvas viewport, a tool rail (move / transform, marquee, lasso and polygonal lasso, magic wand, quick AI select, crop, brush, eraser, clone stamp, text, shapes, hand, zoom, eyedropper), a layers panel, an inspector (properties, filters with live parameters and a curve editor, looks, layer effects, masks, canvas settings), AI dialogs (background removal, masks), an export dialog, the templates gallery on the start screen and an optional AI assistant. It previews with the same engine that renders headless for the agent, so what you see is what exports.

```bash
npx -y @fleox/agentphoto@0.1.1 studio --project my-photo
```

`agentphoto studio` serves the Studio on `http://127.0.0.1:4330/` (next free port; `--port`, `--no-open`) with a local REST API over the project folder (contract: [studio-api.md](studio-api.md)). Edits go through the same AI tool catalog as the CLI and the MCP server, so validation is identical. Changes made by another program (an agent in a terminal, a text editor) are pushed to the open Studio and appear live: you can watch your agent work, then take over by hand.

Without the CLI (`npm run dev` in a clone) the Studio keeps projects in the browser (IndexedDB) and runs the engine in the page. The interface is available in English and French.

![The Studio](images/studio-editor.jpg)

## Painting and selections

- **Brush (B), Eraser (E), Clone stamp (S, Alt-click sets the source)** — size (`[` `]`), hardness, opacity, flow. On an image layer each stroke saves a new file in `assets/edits/` (filters and mask stay live); on text, shape or fill layers a new "Paint" layer is created. Click a layer's mask chip to paint the **mask** instead (hide / reveal).
- **Selections** — marquee (M), lasso and polygonal lasso (L), magic wand (W: tolerance, contiguous or whole image), quick AI select (Q: click to include, Alt-click to exclude, Segment Anything runs on this computer). Shift adds, Alt subtracts, Shift+Alt intersects.
- **Selection actions** — mask the layer, delete (hides pixels through the mask), copy to a new layer, fill, masked adjustment layer, invert, feather, crop to the selection.
- **Rasterize layer** (context menu) turns text, shapes and fills into pixels.

![Quick AI select](images/studio-ai-select.jpg)

## Working with an agent

- Ask the agent to open the Studio on the project when you want to finish by hand (skill `agentphoto-publish`), or run the command yourself in another terminal.
- Everything you do is saved to `photo.json`; AI and painted masks are written as new files in `assets/masks/`, brush / eraser / clone strokes as new files in `assets/edits/` (each stroke is one undo step). Your source photos are never modified.
- The agent reads the document again (`doc summary`) before its next change, so it sees your layers.

## The assistant

The assistant panel runs a tool-use loop with Claude over the same tools (including `render_preview`, whose images it looks at). It calls the Claude Messages API directly from the browser with **your own API key**, stored in the browser's `localStorage` and sent only to `api.anthropic.com`. Images go to Claude only when a tool renders a preview (the render of your document is attached so Claude can look at it); nothing else in the Studio sends your photos anywhere. It is optional; everything else in the Studio works without it, offline.

## AI in the browser

Background removal and Segment Anything masks run in the page (ONNX models through transformers.js, WebAssembly). With `agentphoto studio`, models come from the local cache (`~/.cache/agentphoto/models`) through the server's `/__models/` proxy and are downloaded from Hugging Face only the first time: the Studio shows a one-time download notice (model, size, licence) only for a model the cache does not hold yet (`agentphoto models list` shows what is cached; `models pull` fetches one ahead of time).

## Static hosting and links from an agent

The npm package's `dist/` is a static site as it is: `dist/index.html` opens `studio/index.html`, and ONNX Runtime is in `engine/ort/`. Served that way (no CLI), the Studio runs in local mode: projects in the browser, engine in the page. An agent platform that serves it next to its chat can give links that open the agent's work in it:

- `studio/index.html#import=<ref>` imports `<ref>` as a new browser project, then replaces the link with `?project=<id>` (a reload does not import twice; the same bundle opens the same stored project, with the person's edits). `<ref>` is an image or a **project bundle**, on the page's own origin.
- A project bundle is one JSON file: `{"format": "agentphoto-project", "version": 1, "title": "Lake", "files": {"photo.json": "<base64>", "agentphoto.json": "<base64>", "assets/images/lake.jpg": "<base64>", …}}`, the project folder without `renders/` and `dist/`.
- `config.js` (next to `index.html`, or at the root of the hosted `dist/`) sets `window.__AGENTPHOTO_CONFIG__`:
  - `importUrl`: how a relative `<ref>` becomes a URL, e.g. `"/api/v1/sessions/{session}/workspace/raw?path={path}"`; `{path}` is URL-encoded;
  - `sessionFromReferrer`: a regular expression with one group that finds `{session}` in the page the link was clicked on (e.g. `"/s/([^/?#]+)"`); `#session=<id>` in the link overrides it;
  - `ortBase`: where ONNX Runtime is, relative to the Studio (`"../engine/ort/"` for a hosted `dist/`).
- The download uses the person's own session (same origin, cookies); a URL on another origin is refused. Nothing goes back to the platform: the person exports from the Studio.

The page needs `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:` and, for the AI tools, `connect-src` to `https://huggingface.co` and its CDN (`*.huggingface.co`, `*.hf.co`).

## Shortcuts

Tool keys are shown in the tool rail (move `V`, marquee `M`, lasso `L`, magic wand `W`, quick AI select `Q`, crop `C`, brush `B`, eraser `E`, clone `S`, text `T`, shapes `U`, hand `H`, zoom `Z`, eyedropper `I`); the shortcuts dialog in the Studio lists them all and is the reference.

## Security

The Studio server binds 127.0.0.1 only and rejects requests whose `Host` or `Origin` is not local (DNS rebinding / cross-site protection); project paths cannot leave the folder. See [security.md](security.md).
