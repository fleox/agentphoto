import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS, GLOBAL_OPTIONS } from "../agent/commands/index";
// @ts-expect-error — plain ESM helper shared with scripts/build-cli-docs.mjs
import { BEGIN, END, renderCliReference } from "./cli-docs.mjs";

// docs/cli.md documents every command, action and option of the CLI
// (generated section). Regenerate with `node scripts/build-cli-docs.mjs`.

const root = resolve(__dirname, "..");

describe("docs/cli.md", () => {
  it("matches the CLI's commands, actions and options", () => {
    const help = {
      globalOptions: GLOBAL_OPTIONS,
      commands: COMMANDS.map(({ name, summary, usage, options, subcommands, writes }) => ({ name, summary, usage, options, ...(subcommands ? { subcommands } : {}), ...(writes ? { writes } : {}) })),
    };
    const doc = readFileSync(resolve(root, "docs/cli.md"), "utf8");
    const generated = doc.slice(doc.indexOf(BEGIN) + BEGIN.length, doc.indexOf(END)).trim();
    expect(generated).toBe(renderCliReference(help).trim());
  });
});
