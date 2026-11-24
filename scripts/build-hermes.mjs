// Builds the Hermes Agent skills (hermes/skills/) from the agent skills
// (plugin/skills/) and the Python helpers (hermes/python/):
//
//   hermes/skills/<name>/SKILL.md        Hermes frontmatter + the same body,
//                                        commands run through scripts/agentphoto.py
//   hermes/skills/<name>/references/     same files, same rewrite
//   hermes/skills/<name>/scripts/*.py    agentphoto.py (+ the skill's helpers),
//                                        version-pinned
//
// plugin/skills stays the single source of truth: never edit hermes/skills
// by hand. `--check` fails when the committed output is stale.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const check = process.argv.includes("--check");

const SOURCE = join(root, "plugin", "skills");
const PY = join(root, "hermes", "python");
const OUT = join(root, "hermes", "skills");

// Python helpers shipped with each skill (agentphoto.py always). export_set.py
// imports render_and_check.py: keep them together.
const HELPERS = {
  "agentphoto-retouch": ["open_photo.py", "render_and_check.py"],
  "agentphoto-cutout": ["cutout.py", "render_and_check.py"],
  "agentphoto-design": ["open_photo.py", "render_and_check.py"],
  "agentphoto-publish": ["export_set.py", "render_and_check.py"],
};
const TAGS = {
  "agentphoto-retouch": ["AgentPhoto", "Photo", "Retouching", "Colour", "Filters", "Image"],
  "agentphoto-cutout": ["AgentPhoto", "Photo", "Background-removal", "Masks", "Local-AI"],
  "agentphoto-design": ["AgentPhoto", "Design", "Social-media", "Thumbnails", "Banners", "Typography"],
  "agentphoto-publish": ["AgentPhoto", "Export", "Images", "Web", "Social-media"],
};

const RUN_SKILL = "python3 ${HERMES_SKILL_DIR}/scripts/agentphoto.py";
const RUN_REF = "python3 <skill dir>/scripts/agentphoto.py";

function frontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) throw new Error("no frontmatter");
  const get = (key) => new RegExp(`^${key}:\\s*(.*)$`, "m").exec(m[1])?.[1]?.trim() ?? "";
  return { name: get("name"), description: get("description"), license: get("license"), body: md.slice(m[0].length) };
}

// Commands and Claude Code specifics → the Hermes wrapper. The wrapper adds
// --json itself; keeping it in the commands is harmless and keeps them copyable.
function rewrite(text, run) {
  return text
    .replace(/npx -y @fleox\/agentphoto@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)? /g, `${run} `)
    .replace(/with the Read tool/g, "with your vision / image tool");
}

function hermesHeader(name) {
  const helpers = HELPERS[name] ?? [];
  return [
    "## Running the commands (Hermes)",
    "",
    `Every \`agentphoto <command>\` below runs through this skill's Python wrapper: \`${RUN_SKILL} <command> …\`. It adds \`--json\`, prints the CLI's JSON object (\`{"ok": true, "data": …}\` or \`{"ok": false, "error": {code, message, hint}}\`) and exits with the CLI's code. In the reference files, \`${RUN_REF}\` means the same command with this skill's directory.`,
    "",
    "- **Requirements:** Python 3.9+ (stdlib only), **Node.js 22+** and, for renders, AI cut-outs and exports, Google Chrome / Chromium / Edge. The AgentPhoto engine is the `@fleox/agentphoto` npm package, fetched by `npx` on first use and pinned to the version of these skills. Without Node.js the wrapper answers `node-missing` with how to install it. `AGENTPHOTO_CMD` overrides the engine command (e.g. `node /path/to/agentphoto/dist/agent/agentphoto.mjs` from a clone); `AGENTPHOTO_CHROME` points at a browser binary.",
    "- **From Python:** `sys.path.insert(0, \"${HERMES_SKILL_DIR}/scripts\")`, then `from agentphoto import run, patch, needs_confirmation, AgentPhotoError` — `run(\"analyze\", project=\"my-photo\")` returns `data` and raises `AgentPhotoError(code, message, hint, details)` when `ok` is false (validation issues are in `details[\"issues\"]`); `patch(ops, project=…)` sends `doc patch` ops on stdin.",
    "- **Plans:** a command that needs `--yes` and didn't get it writes nothing and answers `needsConfirmation: true` on `data` — test it with `needs_confirmation(data)`. Show the plan to the user before re-running with `--yes`.",
    "- **Looking at renders:** `render` returns absolute PNG paths in `data.files` (with `--compare`: before, then after). Open them with your vision / image tool; if you can't view images, rely on `analyze` and `check` and tell the user you couldn't check the look.",
    "- **Long-running commands** (`studio`, `mcp`) need the user's own terminal: give them the command instead of running it. `studio --project <dir>` opens the visual editor so the user can finish by hand.",
    ...(helpers.length
      ? ["- **Helpers** in `${HERMES_SKILL_DIR}/scripts/` (each prints one JSON object; `--help` for options):", ...helpers.map((h) => `  - \`${h}\`: ${helperSummary(h)}`)]
      : []),
    "",
  ].join("\n");
}

function helperSummary(file) {
  const src = readFileSync(join(PY, file), "utf8");
  const doc = /"""([\s\S]*?)"""/.exec(src)?.[1]?.trim().split("\n")[0] ?? "";
  return doc.replace(/\.$/, "") + ".";
}

function buildSkill(name) {
  const src = join(SOURCE, name);
  const fm = frontmatter(readFileSync(join(src, "SKILL.md"), "utf8"));
  if (!TAGS[name]) throw new Error(`scripts/build-hermes.mjs: add "${name}" to HELPERS and TAGS`);
  const others = Object.keys(HELPERS).filter((n) => n !== name);
  const header = [
    "---",
    `name: ${fm.name}`,
    `description: ${JSON.stringify(fm.description.replace(/^"|"$/g, ""))}`,
    `version: ${version}`,
    "author: AgentPhoto",
    `license: ${fm.license}`,
    "platforms: [macos, linux, windows]",
    "metadata:",
    "  hermes:",
    `    tags: [${TAGS[name].join(", ")}]`,
    `    related_skills: [${others.join(", ")}]`,
    "---",
    "",
  ].join("\n");
  // Insert the Hermes section right before the first "## " section.
  const body = rewrite(fm.body, RUN_SKILL);
  const firstSection = body.indexOf("\n## ");
  const merged = firstSection >= 0 ? body.slice(0, firstSection + 1) + hermesHeader(name) + "\n" + body.slice(firstSection + 1) : body + "\n" + hermesHeader(name);
  const files = new Map([["SKILL.md", header + merged]]);
  const refs = join(src, "references");
  if (existsSync(refs)) {
    for (const f of readdirSync(refs)) files.set(`references/${f}`, rewrite(readFileSync(join(refs, f), "utf8"), RUN_REF));
  }
  for (const py of ["agentphoto.py", ...(HELPERS[name] ?? [])]) {
    files.set(`scripts/${py}`, readFileSync(join(PY, py), "utf8").replace(/__AGENTPHOTO_VERSION__/g, version));
  }
  return files;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const expected = new Map();
for (const name of readdirSync(SOURCE)) {
  if (!existsSync(join(SOURCE, name, "SKILL.md"))) continue;
  for (const [rel, content] of buildSkill(name)) expected.set(join(OUT, name, rel), content);
}

if (check) {
  const problems = [];
  for (const [file, content] of expected) {
    if (!existsSync(file)) problems.push(`missing ${relative(root, file)}`);
    else if (readFileSync(file, "utf8") !== content) problems.push(`stale ${relative(root, file)}`);
  }
  for (const file of walk(OUT)) if (!expected.has(file) && !file.includes("__pycache__")) problems.push(`extra ${relative(root, file)}`);
  if (problems.length) {
    console.error(`[hermes] hermes/skills is out of date (run \`npm run hermes:build\`):\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`[hermes] ${expected.size} file(s) up to date for agentphoto ${version}`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  for (const [file, content] of expected) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { mode: file.endsWith(".py") ? 0o755 : 0o644 });
  }
  console.log(`[hermes] wrote ${expected.size} file(s) to hermes/skills for agentphoto ${version}`);
}
