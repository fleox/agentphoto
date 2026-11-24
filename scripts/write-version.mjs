// Writes dist/version.json — what agents and the skills compare to decide
// whether the CLI, the engine or the skills are out of date:
//   version          release of this repo / npm package (package.json)
//   minSkillsVersion oldest skills that still work with this dist
//                    (package.json → agentphoto.minSkillsVersion, default: version)
//   docVersion       PhotoDoc format version (src/core/types.ts DOC_VERSION, default 1)
// Run by `npm run build` after the vite builds.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
let docVersion = 1;
try {
  const types = readFileSync(join(root, "src", "core", "types.ts"), "utf8");
  docVersion = Number(/DOC_VERSION\s*=\s*(\d+)/.exec(types)?.[1] ?? 1);
} catch {
  /* default */
}

const info = {
  name: pkg.name,
  version: pkg.version,
  minSkillsVersion: pkg.agentphoto?.minSkillsVersion ?? pkg.version,
  docVersion,
  repository: "github:fleox/agentphoto",
};
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist", "version.json"), JSON.stringify(info, null, 2) + "\n");
// The npm bin entry; executable so `./dist/agent/agentphoto.mjs` works in a clone.
const bin = join(root, "dist", "agent", "agentphoto.mjs");
if (existsSync(bin)) chmodSync(bin, 0o755);
// Hosting the package's dist/ as a static site (the Studio in studio/index.html, ONNX
// Runtime in engine/ort/, docs/studio.md "Static hosting"): its root opens
// the Studio. A meta refresh, no script, so a strict CSP allows it.
writeFileSync(
  join(root, "dist", "index.html"),
  '<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url=studio/index.html">\n<title>AgentPhoto Studio</title>\n<a href="studio/index.html">AgentPhoto Studio</a>\n',
);
console.log(`[version] dist/version.json → ${info.version}`);
