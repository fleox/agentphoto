import { format } from "node:util";

// Output protocol shared by every command (mirror of agentcrm agent/output.ts).
// Agents parse --json output, so it is one JSON object per invocation:
//   success → { "ok": true, "data": … }
//   failure → { "ok": false, "error": { "code", "message", "hint"? } }
// Human mode prints plain text. Logs and progress always go to stderr so
// they never corrupt the JSON on stdout. Exit codes: 0 ok, 1 failure,
// 2 usage error (bad arguments, invalid input, validation).

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string,
    readonly exitCode = 1,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

// stdout belongs to the command's result (one JSON object with --json, the
// JSON-RPC frames of `mcp`). Third-party code (libraries) may call console.log / info / debug: send those to stderr
// so they never corrupt it. Called once by the binary entry (agent/bin.ts).
export function routeConsoleToStderr(target: Pick<Console, "log" | "info" | "debug"> = console, write: (text: string) => void = (t) => void process.stderr.write(t)): void {
  const toStderr = (...args: unknown[]) => write(`${format(...args)}\n`);
  target.log = toStderr;
  target.info = toStderr;
  target.debug = toStderr;
}

export interface Io {
  json: boolean;
  out(text: string): void;
  err(text: string): void;
}

export function createIo(json: boolean): Io {
  return {
    json,
    out: (text) => process.stdout.write(text.endsWith("\n") ? text : text + "\n"),
    err: (text) => process.stderr.write(text.endsWith("\n") ? text : text + "\n"),
  };
}

// Ops and AI-tool hints may name AI tools ("doc_summary"); on the CLI they
// must name commands. Tool name → CLI
// command ("check" and "export" are plain words in hints: left alone).
const TOOL_COMMANDS: Record<string, string> = {
  project_info: "agentphoto info",
  project_create: "agentphoto new <dir>",
  doc_get: "agentphoto doc get",
  doc_summary: "agentphoto doc summary",
  doc_apply: "agentphoto doc apply",
  doc_patch: "agentphoto doc patch",
  doc_validate: "agentphoto doc validate",
  layer_list: "agentphoto layer list",
  layer_add: "agentphoto layer add",
  layer_update: "agentphoto layer update",
  layer_remove: "agentphoto layer remove",
  layer_move: "agentphoto layer move",
  filter_add: "agentphoto filter add",
  mask_set: "agentphoto mask set",
  remove_background: "agentphoto remove-bg",
  mask_generate: "agentphoto mask generate",
  image_analyze: "agentphoto analyze",
  render_preview: "agentphoto render",
  catalog_get: "agentphoto catalog",
  templates_list: "agentphoto templates list",
  library_list: "agentphoto assets library",
  assets_list: "agentphoto assets list",
  assets_add: "agentphoto assets add",
  assets_remove: "agentphoto assets remove",
};
const TOOL_NAMES = Object.keys(TOOL_COMMANDS).join("|");
const TOOL_RE = new RegExp(`\\b(${TOOL_NAMES})\\b`, "g");
// "library_list (CLI: agentphoto assets library)" / "assets_add / `agentphoto assets add`" → keep the CLI part only.
const TOOLS_THEN_CLI = new RegExp(`\\b(?:${TOOL_NAMES})(?:\\s*[/+,]\\s*(?:${TOOL_NAMES}))*\\s*(?:\\(CLI:\\s*([^)]*)\\)|,\\s*CLI:\\s*([^)]*)|/\\s*(\`agentphoto[^\`]*\`))`, "g");

export function cliHint(text: string): string {
  if (!TOOL_RE.test(text)) return text;
  TOOL_RE.lastIndex = 0;
  return text
    .replace(TOOLS_THEN_CLI, (_m, a?: string, b?: string, c?: string) => {
      const cli = (a ?? b ?? c ?? "").trim();
      return cli.startsWith("`") ? cli : `\`${cli}\``;
    })
    .replace(TOOL_RE, (name: string) => `\`${TOOL_COMMANDS[name]}\``)
    .replace(/``+/g, "`");
}

// Deep-rewrites every "hint" string of a result for the CLI.
export function withCliHints<T>(data: T): T {
  if (Array.isArray(data)) return data.map((v) => withCliHints(v)) as T;
  if (!data || typeof data !== "object") return data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) out[k] = k === "hint" && typeof v === "string" ? cliHint(v) : withCliHints(v);
  return out as T;
}

// `opts.raw`: keep AI-tool hints untouched (`agentphoto tools call` returns tool results as-is).
export function printResult(io: Io, data: unknown, human: () => string, opts: { raw?: boolean } = {}): void {
  const shown = opts.raw ? data : withCliHints(data);
  if (io.json) io.out(JSON.stringify({ ok: true, data: shown }));
  else io.out(human());
}

const OPS_HINTS: Record<string, string> = {
  notFound: "Check the id or path (`agentphoto layer list`, `agentphoto doc summary`, `agentphoto assets list` print them).",
  validation: "Fix the document and retry: `agentphoto doc validate` lists every issue with its JSON path and a hint; `agentphoto catalog <section> <id>` documents the parameters.",
  conflict: "Something with the same id already exists — list it first (`agentphoto layer list`), then update instead of adding, or pick another id.",
  invalid: "Check the arguments with `agentphoto help <command>`.",
  unavailable: "This needs the image engine: install Google Chrome (or `npx playwright install chromium`) and run `agentphoto doctor`.",
  io: "A file could not be read or written: check the path and permissions of the project folder (--project <dir>).",
};

// Known errors thrown by the engine (OpsError, FsError, PathError), translated
// into codes and hints an agent can act on.
export function knownError(error: unknown): CliError | null {
  if (!(error instanceof Error)) return null;
  if (error.name === "OpsError") {
    const e = error as Error & { code?: string; hint?: string; details?: unknown };
    const code = e.code ?? "invalid";
    return new CliError(code, error.message, e.hint || OPS_HINTS[code] || OPS_HINTS.invalid, code === "validation" || code === "invalid" ? 2 : 1, e.details);
  }
  if (error.name === "PathError") {
    return new CliError("invalid-path", error.message, (error as Error & { hint?: string }).hint || 'Paths look like "canvas.background", "layers#title.size" or "layers#photo.filters[0].amount" (`agentphoto doc summary` lists the ids).', 2);
  }
  if (error.name === "FsError") {
    const code = (error as Error & { code?: string }).code;
    if (code === "notFound") return new CliError("notFound", error.message, "Is --project pointing at an AgentPhoto project folder (agentphoto.json + photo.json)? Create one with `agentphoto new <dir>`.");
    if (code === "invalidPath") return new CliError("invalid-path", error.message, 'Project paths are relative to the project folder and never contain ".." or an absolute prefix.', 2);
    return new CliError("io", error.message, OPS_HINTS.io);
  }
  return null;
}

export function toCliError(error: unknown): CliError {
  return error instanceof CliError
    ? error
    : (knownError(error) ??
        new CliError("internal", error instanceof Error ? error.message : String(error), "Unexpected error. Retry once; if it persists, report it with the command and this output (`agentphoto doctor` checks the setup)."));
}

// CLI output: hints name commands (MCP and the Studio API keep tool names).
export function printError(io: Io, error: unknown): number {
  const e = toCliError(error);
  const hint = e.hint ? cliHint(e.hint) : undefined;
  const details = e.details !== undefined ? { details: withCliHints(e.details) } : {};
  if (io.json) io.out(JSON.stringify({ ok: false, error: { code: e.code, message: e.message, ...(hint ? { hint } : {}), ...details } }));
  else io.err(`Error: ${e.message}${hint ? `\nHint: ${hint}` : ""}`);
  return e.exitCode;
}
