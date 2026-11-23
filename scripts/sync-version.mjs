// Copies package.json's version into every file that repeats it: the
// Claude Code plugin manifest, each skill's metadata.version, every pinned
// `@fleox/agentphoto@x.y.z` command in the skills, the docs and the README.
// Run by the npm "version" lifecycle (`npm version patch|minor|major`), so a
// release bumps them all.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const PIN = /@fleox\/agentphoto@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g;

const pluginJson = join(root, "plugin", ".claude-plugin", "plugin.json");
const plugin = JSON.parse(readFileSync(pluginJson, "utf8"));
plugin.version = version;
writeFileSync(pluginJson, JSON.stringify(plugin, null, 2) + "\n");

let files = 0;
const rewrite = (file, isSkill) => {
  const before = readFileSync(file, "utf8");
  let after = before.replace(PIN, `@fleox/agentphoto@${version}`);
  if (isSkill && file.endsWith("SKILL.md")) after = after.replace(/^(\s+version:\s*)["']?[^"'\n]+["']?$/m, `$1"${version}"`);
  if (after !== before) {
    writeFileSync(file, after);
    files++;
  }
};

const skillsDir = join(root, "plugin", "skills");
for (const name of readdirSync(skillsDir)) {
  const dir = join(skillsDir, name);
  if (!existsSync(join(dir, "SKILL.md"))) continue;
  for (const file of walk(dir)) rewrite(file, true);
}
// Docs, README and AGENTS.md pin the same version in their snippets.
for (const file of [join(root, "README.md"), join(root, "AGENTS.md"), ...walk(join(root, "docs"))]) {
  if (existsSync(file)) rewrite(file, false);
}
console.log(`[sync-version] ${version} → plugin.json + ${files} file(s)`);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : []));
}
