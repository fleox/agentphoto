import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliError, printResult } from "../output";
import { distRoot, engineBuilt, engineDir, isBundled, libraryDir, modelsDir, packageRoot, readVersionInfo, studioDir, templatesDir } from "../paths";
import type { Command } from "./types";
import { boolOpt } from "./util";

export const versionCommand: Command = {
  name: "version",
  usage: "version",
  summary: "Print the AgentPhoto version (CLI = engine = skills version).",
  options: [],
  async run({ io }) {
    const info = readVersionInfo();
    printResult(io, { ...info, bundled: isBundled(), node: process.versions.node }, () => info.version);
  },
};

export interface DoctorCheck {
  id: string;
  ok: boolean;
  message: string;
  hint?: string;
  // Informational checks never fail the doctor.
  optional?: boolean;
  details?: Record<string, unknown>;
}

// The doc the doctor renders: a two-colour gradient + a shape (no files needed).
export const DOCTOR_DOC = {
  version: 1,
  id: "doctor",
  canvas: { width: 128, height: 96, background: "#1d2330" },
  layers: [{ id: "dot", type: "shape", shape: "ellipse", x: 32, y: 16, width: 64, height: 64, fill: "#ff6a3d" }],
};

// Only blame the browser when the browser failed: errors with a known code
// keep their own hint; anything else is reported as an AgentPhoto bug.
const BROWSER_CODES = new Set(["browser-launch", "no-browser", "cdp-connect"]);
export function renderFailure(e: unknown): DoctorCheck {
  const err = e as Error & { code?: string; hint?: string };
  const code = err instanceof CliError ? err.code : undefined;
  const hint =
    err.hint ??
    (code && BROWSER_CODES.has(code)
      ? "Update Chrome, or point AGENTPHOTO_CHROME at Google Chrome / Chromium (`npx playwright install chromium`)."
      : "The browser started but the test render failed inside AgentPhoto: retry once, then report it with this output (`agentphoto version`).");
  return { id: "render", ok: false, message: `Test render failed${code ? ` (${code})` : ""}: ${err.message}`, hint, ...(code ? { details: { code } } : {}) };
}

export const doctorCommand: Command = {
  name: "doctor",
  usage: "doctor [--no-render]",
  summary: "Check the setup: Node version, installed Chrome (+ version), the engine / Studio builds, library, templates, the AI model cache, and a headless test render. A failed required check makes the command fail (exit 1, error code doctor-failed, one hint per failed check, every check in error.details.checks).",
  options: [{ name: "no-render", type: "boolean", description: "Skip the test render." }],
  async run({ io, options }) {
    const checks: DoctorCheck[] = [];
    const major = Number(process.versions.node.split(".")[0]);
    checks.push({ id: "node", ok: major >= 22, message: `Node ${process.versions.node}${major >= 22 ? "" : " (AgentPhoto needs Node 22+)"}`, ...(major < 22 ? { hint: "Install Node 22 or newer (https://nodejs.org)." } : {}) });
    const { findBrowser, browserVersion, noBrowserError } = await import("../render/browser");
    const browser = findBrowser();
    if (browser) {
      const version = await browserVersion(browser.path);
      checks.push({ id: "browser", ok: true, message: `${browser.name}${version ? ` — ${version}` : ""}`, details: { path: browser.path, source: browser.source, version } });
    } else {
      const e = noBrowserError();
      checks.push({ id: "browser", ok: false, message: e.message, hint: e.hint });
    }
    checks.push(
      engineBuilt()
        ? { id: "engine", ok: true, message: `Engine build found (${engineDir()})`, details: { ai: existsSync(join(engineDir(), "ort")) } }
        : { id: "engine", ok: false, message: `Engine build missing (${engineDir()})`, hint: "Use the npm package, or run `npm run build:engine` in a clone (AGENTPHOTO_DIST overrides the dist folder)." },
    );
    const studio = existsSync(join(studioDir(), "index.html"));
    checks.push({ id: "studio", ok: studio, optional: true, message: studio ? `Studio build found (${studioDir()})` : `Studio build missing (${studioDir()}) — \`agentphoto studio\` needs it`, ...(studio ? {} : { hint: "Run `npm run build:studio` in a clone (the npm package ships it)." }) });
    const lib = existsSync(join(libraryDir(), "index.json"));
    checks.push({ id: "library", ok: lib, optional: true, message: lib ? `Library found (${libraryDir()})` : `Library index missing (${join(libraryDir(), "index.json")})` });
    const tpl = existsSync(templatesDir());
    checks.push({ id: "templates", ok: tpl, optional: true, message: tpl ? `Templates found (${templatesDir()})` : `Templates folder missing (${templatesDir()})` });
    const { listCachedModels } = await import("../render/models");
    const cached = listCachedModels().filter((m) => m.cached);
    checks.push({ id: "models", ok: true, optional: true, message: `AI model cache ${modelsDir()}: ${cached.length ? cached.map((m) => `${m.id} (${m.cachedMb} MB)`).join(", ") : "empty (models download once on first use, or `agentphoto models pull <id>`)"}`, details: { dir: modelsDir(), cached: cached.map((m) => m.id) } });

    if (!boolOpt(options, "no-render")) {
      if (!browser || !engineBuilt() || major < 22) {
        checks.push({ id: "render", ok: false, message: "Test render skipped (needs Chrome, the engine build and Node 22+).", hint: "Fix the checks above, then run `agentphoto doctor` again." });
      } else {
        const dir = mkdtempSync(join(tmpdir(), "agentphoto-doctor-"));
        const { EngineSession, decodeImage } = await import("../render/session");
        const session = new EngineSession(dir);
        try {
          const t0 = Date.now();
          const img = decodeImage(await session.call("render", DOCTOR_DOC, { format: "png" }));
          const ok = img.bytes.byteLength > 100 && img.width === 128 && img.height === 96 && img.bytes[0] === 0x89;
          checks.push({ id: "render", ok, message: ok ? `Headless render OK in ${Date.now() - t0} ms (${img.width}×${img.height} PNG, ${img.bytes.byteLength} bytes)` : "The test render returned an unexpected image.", ...(ok ? {} : { hint: "Update Chrome, or point AGENTPHOTO_CHROME at Google Chrome / Chromium." }) });
        } catch (e) {
          checks.push(renderFailure(e));
        } finally {
          await session.close();
          rmSync(dir, { recursive: true, force: true });
        }
      }
    }
    const ok = checks.every((c) => c.ok || c.optional);
    const info = readVersionInfo();
    const human = () =>
      [`agentphoto ${info.version} doctor`, ...checks.map((c) => `  ${c.ok ? "✓" : c.optional ? "·" : "✗"} ${c.id.padEnd(9)} ${c.message}${c.hint && !c.ok ? `\n              → ${c.hint}` : ""}`), "", ok ? "All good." : "Some checks failed."].join("\n");
    if (!ok) {
      const failed = checks.filter((c) => !c.ok && !c.optional);
      if (!io.json) {
        io.out(human());
        return 1;
      }
      throw new CliError("doctor-failed", `${failed.length} required check(s) failed: ${failed.map((c) => `${c.id} (${c.message})`).join("; ")}`, failed.map((c) => `${c.id}: ${c.hint ?? "see details.checks"}`).join(" | "), 1, {
        version: info.version,
        packageRoot: packageRoot(),
        dist: distRoot(),
        failed: failed.map((c) => c.id),
        checks,
      });
    }
    printResult(io, { ok, version: info.version, packageRoot: packageRoot(), dist: distRoot(), checks }, human);
    return 0;
  },
};
