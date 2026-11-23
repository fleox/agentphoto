// Every command the CLI exposes. `help --json` lists them (with their
// subcommands and options); skills must only mention commands that are here.
import { CliError, printResult } from "../output";
import { readVersionInfo } from "../paths";
import { assetsCommand } from "./assets";
import { catalogCommand, templatesCommand } from "./catalog";
import { docCommand, filterCommand, layerCommand, maskCommand } from "./doc";
import { analyzeCommand, checkCommand, exportCommand, removeBgCommand, renderCommand } from "./image";
import { doctorCommand, versionCommand } from "./meta";
import { modelsCommand } from "./models";
import { infoCommand, newCommand } from "./project";
import { studioCommand } from "./serve";
import { mcpCommand, toolsCommand } from "./tools";
import type { Command, CommandOption } from "./types";

export const GLOBAL_OPTIONS: CommandOption[] = [
  { name: "json", type: "boolean", description: "Print one JSON object on stdout: { ok, data } or { ok: false, error: { code, message, hint } }." },
  { name: "help", type: "boolean", description: "Show the command's usage and options instead of running it." },
];

const helpCommand: Command = {
  name: "help",
  usage: "help [<command>]",
  summary: "List commands with their subcommands and options (--json gives a machine-readable list).",
  options: [],
  async run({ io, positionals }) {
    const wanted = positionals[0];
    const list = wanted ? COMMANDS.filter((c) => c.name === wanted) : COMMANDS;
    if (wanted && !list.length) throw new CliError("unknown-command", `Unknown command "${wanted}".`, `Available: ${COMMANDS.map((c) => c.name).join(", ")}.`, 2);
    const { version } = readVersionInfo();
    const data = {
      name: "agentphoto",
      version,
      globalOptions: GLOBAL_OPTIONS,
      commands: list.map(({ name, summary, usage, options, subcommands, writes }) => ({ name, summary, usage, options, ...(subcommands ? { subcommands } : {}), ...(writes ? { writes } : {}) })),
    };
    printResult(io, data, () =>
      [
        `agentphoto ${version} — the photo studio your AI agent can run.`,
        "",
        "Usage: agentphoto <command> [options] [--json]",
        "",
        ...list.flatMap((c) => [
          `  ${c.usage}`,
          `      ${c.summary}`,
          ...(wanted ? (c.subcommands ?? []).map((s) => `      · ${s.usage}\n          ${s.summary}`) : []),
          ...(wanted ? c.options.map((o) => `      --${o.name}${o.type === "string" ? " <value>" : ""}  ${o.description}`) : []),
        ]),
        "",
        "Global options:",
        ...GLOBAL_OPTIONS.map((o) => `  --${o.name}  ${o.description}`),
        ...(wanted ? [] : ["", "`agentphoto help <command>` shows a command's actions and options."]),
      ].join("\n"),
    );
  },
};

export const COMMANDS: Command[] = [
  helpCommand,
  versionCommand,
  doctorCommand,
  newCommand,
  infoCommand,
  docCommand,
  layerCommand,
  filterCommand,
  maskCommand,
  removeBgCommand,
  analyzeCommand,
  renderCommand,
  exportCommand,
  checkCommand,
  catalogCommand,
  templatesCommand,
  assetsCommand,
  modelsCommand,
  studioCommand,
  toolsCommand,
  mcpCommand,
];

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}
