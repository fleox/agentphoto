# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories ("Report a vulnerability" on the repository's Security tab), or by opening an issue asking for a private contact if advisories are unavailable. Don't include exploit details or private photos in public issues. We aim to acknowledge within 72 hours.

## Security model

AgentPhoto has no server and no account: the CLI, the MCP server and the Studio run on the user's computer, and projects are folders on the user's disk. The trust boundaries are:

- **Photos stay local.** Editing, previews, colour analysis, background removal, AI masks and exports run in Node.js and in the user's own Chrome / Chromium / Edge / Brave, started headless with a temporary profile over a local DevTools connection. Source files are never modified: imports are copied into `assets/images/`, edits are data in `photo.json`, masks and painted pixels are new files.
- **The network** is used only for the one-time download of an AI model from `huggingface.co` (cached in `~/.cache/agentphoto/models`, served to the page through the CLI's local proxy), for images the user asks to fetch by URL (`new --image <url>`, `assets add --url`, MCP `assets_add`), by `npx` fetching the package, and by the optional Studio assistant, which sends the conversation to `api.anthropic.com` with the user's own API key kept in the browser's `localStorage`. No telemetry, no update check, no CDN, no web fonts.
- **Local servers** (`studio` and the headless render server) bind 127.0.0.1 only. The Studio API rejects requests whose `Host` is not local or whose `Origin` is another site (DNS rebinding, CSRF). Project paths are relative: `..`, absolute paths and symlinks leaving the project folder are refused; the model proxy refuses paths that are not model files.
- **Documents are data**: no scripts, no HTML. Text layers are drawn as text on a canvas; validation refuses unknown layer types and parameters.

Details: [docs/security.md](https://github.com/fleox/agentphoto/blob/main/docs/security.md).

## What users should do

- Keep the Studio assistant's API key to your own browser; use the assistant panel's "Forget the key" on a shared computer.
- Check the licence of what you publish: RMBG-1.4, the default background remover, is licensed for non-commercial use only (`agentphoto models list` shows every model's licence); record the licence of imported images (`assets add --license --author`).
- Only open projects and templates you trust in the Studio, as you would any file.

## Supported versions

Security fixes go to the latest release; update with `npx -y @fleox/agentphoto@latest version`, and in Claude Code with `/plugin marketplace update agentphoto`.
