// Regenerates the command reference in docs/cli.md from `help --json` of the
// built CLI (dist/agent/agentphoto.mjs). `--check` fails when it is stale.
// scripts/cli-docs.test.ts checks the same thing from source in `npm test`.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCliReference, replaceGenerated } from "./cli-docs.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "docs", "cli.md");
const help = JSON.parse(execFileSync(process.execPath, [join(root, "dist", "agent", "agentphoto.mjs"), "help", "--json"], { encoding: "utf8" })).data;
const before = readFileSync(file, "utf8");
const after = replaceGenerated(before, renderCliReference(help));
if (process.argv.includes("--check")) {
  if (after !== before) {
    console.error("[cli-docs] docs/cli.md is stale: run `node scripts/build-cli-docs.mjs`");
    process.exit(1);
  }
  console.log(`[cli-docs] docs/cli.md up to date (${help.commands.length} commands)`);
} else {
  writeFileSync(file, after);
  console.log(`[cli-docs] wrote docs/cli.md (${help.commands.length} commands)`);
}
