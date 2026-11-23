import { parseArgs } from "node:util";
import { COMMANDS, findCommand, GLOBAL_OPTIONS } from "./commands";
import { CliError, createIo, printError, type Io } from "./output";

// Entry point of `agentphoto` (bundled to dist/agent/agentphoto.mjs). Mirror of
// agent-3d agent/cli.ts.

export async function main(argv: string[], io?: Io): Promise<number> {
  const json = argv.includes("--json");
  const out = io ?? createIo(json);
  try {
    const args = argv.filter((a) => a !== "--json");
    // Global flags / options may come before the command
    // (`agentphoto --project x doc get`): move them after it.
    const leading: string[] = [];
    while (args[0] && args[0].startsWith("--") && LEADING.has(args[0].split("=")[0])) {
      const flag = args.shift()!;
      leading.push(flag);
      if (LEADING_WITH_VALUE.has(flag) && args.length) leading.push(args.shift()!);
    }
    const [name = "help", ...rest] = args;
    rest.push(...leading);
    if (name === "--help" || name === "-h") return (await run("help", rest, out)) ?? 0;
    if (name === "--version" || name === "-v") return (await run("version", rest, out)) ?? 0;
    return (await run(name, rest, out)) ?? 0;
  } catch (error) {
    return printError(out, error);
  }
}

const LEADING_WITH_VALUE: ReadonlySet<string> = new Set(["--project"]);
const LEADING: ReadonlySet<string> = new Set([...GLOBAL_OPTIONS.filter((o) => o.type === "boolean" && o.name !== "help").map((o) => `--${o.name}`), ...LEADING_WITH_VALUE]);

async function run(name: string, args: string[], io: Io): Promise<number | void> {
  const command = findCommand(name);
  if (!command) {
    throw new CliError("unknown-command", `Unknown command "${name}".`, `Available: ${COMMANDS.map((c) => c.name).join(", ")}. Run \`agentphoto help\`.`, 2);
  }
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries([...command.options, ...GLOBAL_OPTIONS].map((o) => [o.name, { type: o.type, ...(o.multiple ? { multiple: true } : {}) }])),
    });
  } catch (e) {
    throw new CliError("usage", (e as Error).message, `Usage: agentphoto ${command.usage} (details: \`agentphoto help ${command.name}\`).`, 2);
  }
  if (parsed.values.help && command.name !== "help") return run("help", [command.name], io);
  try {
    return await command.run({
      io,
      options: parsed.values as Record<string, string | boolean | string[] | undefined>,
      positionals: parsed.positionals,
    });
  } catch (e) {
    // Every error carries a hint an agent can act on: usage errors without
    // their own get the command's usage.
    if (e instanceof CliError && !e.hint && e.exitCode === 2) {
      throw new CliError(e.code, e.message, `Usage: agentphoto ${command.usage} (details: \`agentphoto help ${command.name}\`).`, e.exitCode, e.details);
    }
    throw e;
  }
}
