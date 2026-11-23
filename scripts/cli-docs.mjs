// Renders the command reference of docs/cli.md from the CLI's command list
// (the shape of `agentphoto help --json` → data). Shared by
// scripts/build-cli-docs.mjs (writes the file from the built CLI) and
// scripts/cli-docs.test.ts (fails when docs/cli.md is stale, from source).

export const BEGIN = "<!-- BEGIN GENERATED: command reference (node scripts/build-cli-docs.mjs) -->";
export const END = "<!-- END GENERATED -->";

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderCliReference(help) {
  const out = [];
  out.push("| Command | What it does |", "|---|---|");
  for (const c of help.commands) out.push(`| [\`${c.name}\`](#${c.name}) | ${cell(c.summary)} |`);
  out.push("");
  out.push("Global options (every command): " + help.globalOptions.map((o) => `\`--${o.name}\` (${o.description.replace(/\.$/, "")})`).join(", ") + ".");
  for (const c of help.commands) {
    out.push("", `### ${c.name}`, "", cell(c.summary), "", "```", `agentphoto ${c.usage}`, "```");
    if (c.subcommands?.length) {
      out.push("", "| Action | Usage | What it does |", "|---|---|---|");
      for (const s of c.subcommands) out.push(`| \`${s.name}\` | \`agentphoto ${cell(s.usage)}\` | ${cell(s.summary)}${s.destructive ? " **Plan + `--yes`.**" : ""} |`);
    }
    if (c.options?.length) {
      out.push("", "| Option | Description |", "|---|---|");
      for (const o of c.options) out.push(`| \`--${o.name}${o.type === "string" ? " <value>" : ""}\`${o.multiple ? " (repeatable)" : ""} | ${cell(o.description)} |`);
    }
    if (c.writes) out.push("", "_Writes to the project._");
  }
  return out.join("\n") + "\n";
}

export function replaceGenerated(doc, generated) {
  const a = doc.indexOf(BEGIN);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`docs/cli.md must contain the markers ${BEGIN} … ${END}`);
  return doc.slice(0, a + BEGIN.length) + "\n\n" + generated + "\n" + doc.slice(b);
}
