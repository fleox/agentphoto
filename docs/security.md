# Security and privacy

## Your photos stay on your computer

- **Nothing is uploaded.** Projects are folders on your disk. Editing, previews, colour analysis, background removal, AI masks and exports all run locally, in Node.js and in your own Chrome / Chromium / Edge / Brave started headless with a temporary profile.
- **Source files are never modified.** Imported photos are copied into `assets/images/`; edits are data in `photo.json`; AI masks are new PNGs in `assets/masks/`.
- **No account, no telemetry, no update check, no analytics, no CDN, no web fonts.** Fonts are bundled in `library/fonts`.

## What touches the network

| When | What | Where |
|---|---|---|
| First use of an AI model (`remove-bg`, `mask generate`, `models pull`, the Studio's AI dialogs) | The model files (25–170 MB), **once**; cached in `~/.cache/agentphoto/models` (`AGENTPHOTO_MODELS` overrides) | `huggingface.co` |
| `new --image <url>`, `assets add --url`, MCP `assets_add { url }` | The image you asked for, saved into the project with its source | the URL you gave |
| `npx -y @fleox/agentphoto@…` | The package itself | the npm registry |
| The Studio assistant (optional) | The conversation and tool results, with your own API key kept in the browser's `localStorage` | `api.anthropic.com` |

Your photos are never sent anywhere in any of these cases: the models come to the photos, not the reverse. `agentphoto models remove <id>` deletes a model's cache.

## Local servers

`agentphoto studio` and the headless render server bind **127.0.0.1 only**. The Studio API rejects requests whose `Host` is not `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>`, or whose `Origin` is another site (403): this blocks DNS rebinding and cross-site requests from other web pages. Project paths are relative; `..`, absolute paths and symlinks leaving the project folder are refused. Contract: [studio-api.md](studio-api.md).

## Documents

A PhotoDoc is data: no scripts, no HTML. Text layers are drawn as text on a canvas. Image sources are project paths or `library:<id>` references; validation refuses unknown layer types and parameters, and `check` reports files that don't exist.

## Licences of what you use

- AI models: **RMBG-1.4** (the default background remover) is licensed by BRIA AI for **non-commercial** use only (`bria-rmbg-1.4`); **MODNet**, **SlimSAM** and **SAM** are Apache-2.0. For commercial work, use `--model modnet` (people) or Segment Anything masks, or obtain a licence from BRIA. `agentphoto models list` shows each model's licence.
- Bundled fonts: SIL Open Font License 1.1 (Roboto Slab: Apache-2.0); they can be used in any image, commercial included.
- Sample photos: CC0 (public domain dedication).
- Imported images keep the licence and author you record (`assets add --license --author`); `check` lists the ones that need attribution.

## Reporting

Report vulnerabilities privately to the maintainer through GitHub security advisories on `fleox/agentphoto` rather than public issues.
