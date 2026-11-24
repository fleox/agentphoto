# AgentPhoto documentation

The [README](../README.md) is the overview. These pages go into detail.

## Start here

| Document | For |
|---|---|
| [getting-started.md](getting-started.md) | Install, a first edit in six commands, using it from an agent |
| [retouching.md](retouching.md) | Recipes with real before / after renders: colour correction, portrait retouch, product cut-out on white, social formats |
| [studio.md](studio.md) | The visual editor, live changes from the agent, the assistant, AI in the browser |
| [mcp.md](mcp.md) | The MCP server: Claude Code / Desktop and Cursor configuration, tools, resources, the `render_preview` image |

## Reference

| Document | For |
|---|---|
| [document-format.md](document-format.md) | `photo.json` (PhotoDoc) field by field with examples: canvas, layer types, paints and gradients, filters, masks, layer effects, validation |
| [catalog.md](catalog.md) | Every filter, look, layer effect, blend mode, shape, font, size preset and AI model with parameters (generated) |
| [cli.md](cli.md) | The `agentphoto` CLI: conventions, environment, every command, action and option (reference generated) |
| [security.md](security.md) | Privacy (what touches the network: only the one-time model download), local servers, licences of models, fonts and photos |

## Contributors and maintainers

| Document | For |
|---|---|
| [architecture.md](architecture.md) | One engine, four front doors, the headless render loop, the AI models, why there is no server |
| [studio-api.md](studio-api.md) | The Studio's local REST API (contract, owned by the CLI) |

Agent skills: [`plugin/skills/`](../plugin/skills) (Claude Code plugin) and [`hermes/`](../hermes) (Hermes Agent, generated). Templates: [`templates/`](../templates). Built-in assets and their licences: [`library/LICENSES.md`](../library/LICENSES.md). Maintenance rules: [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md).
