import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "../package.json";

// The CLI runs either bundled (dist/agent/agentphoto.mjs, inside the npm
// package or a clone) or from source (agent/*.ts under vitest). Both layouts
// resolve to the same folders:
//   dist/engine    the engine page bundle (agentphoto-engine.js + chunks/ + ort/)
//   dist/studio    the Studio SPA
//   library/       bundled fonts + CC0 sample photos (+ index.json)
//   templates/     starter projects
// $AGENTPHOTO_DIST overrides the dist folder; $AGENTPHOTO_LIBRARY and
// $AGENTPHOTO_TEMPLATES override the other two (tests). AI models are cached
// in ~/.cache/agentphoto/models ($AGENTPHOTO_MODELS overrides).

declare const __AGENTPHOTO_BUNDLED__: boolean | undefined;

export function isBundled(): boolean {
  return typeof __AGENTPHOTO_BUNDLED__ !== "undefined" && !!__AGENTPHOTO_BUNDLED__;
}

// Root of the package this CLI file belongs to.
export function packageRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // bundled: <pkg>/dist/agent/agentphoto.mjs (chunks: <pkg>/dist/agent/chunks/x.mjs)
  if (isBundled()) return here.endsWith("chunks") ? resolve(here, "..", "..", "..") : resolve(here, "..", "..");
  return resolve(here, "..");
}

export function distRoot(): string {
  if (process.env.AGENTPHOTO_DIST) return resolve(process.env.AGENTPHOTO_DIST);
  return join(packageRoot(), "dist");
}

export const engineDir = (): string => join(distRoot(), "engine");
export const studioDir = (): string => join(distRoot(), "studio");
export const libraryDir = (): string => (process.env.AGENTPHOTO_LIBRARY ? resolve(process.env.AGENTPHOTO_LIBRARY) : join(packageRoot(), "library"));
export const templatesDir = (): string => (process.env.AGENTPHOTO_TEMPLATES ? resolve(process.env.AGENTPHOTO_TEMPLATES) : join(packageRoot(), "templates"));
export const modelsDir = (): string => (process.env.AGENTPHOTO_MODELS ? resolve(process.env.AGENTPHOTO_MODELS) : join(homedir(), ".cache", "agentphoto", "models"));

export const ENGINE_ENTRY = "agentphoto-engine.js";

export function engineBuilt(): boolean {
  return existsSync(join(engineDir(), ENGINE_ENTRY));
}

export interface VersionInfo {
  name: string;
  version: string;
}

// dist/version.json when built, else package.json.
export function readVersionInfo(): VersionInfo {
  const file = join(distRoot(), "version.json");
  if (existsSync(file)) {
    try {
      const v = JSON.parse(readFileSync(file, "utf8")) as Partial<VersionInfo>;
      if (v.version) return { name: v.name ?? pkg.name, version: v.version };
    } catch {
      /* fall back to package.json */
    }
  }
  return { name: pkg.name, version: pkg.version };
}

export const PACKAGE_NAME = pkg.name;
