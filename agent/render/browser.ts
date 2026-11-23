import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { CliError } from "../output";

// Finds the user's installed Chromium-family browser (Chrome, Chromium,
// Edge, Brave, or a Playwright-downloaded Chromium) and launches it headless
// with a throw-away profile. No puppeteer / playwright dependency: the CLI
// drives it with its own CDP client (cdp.ts). $AGENTPHOTO_CHROME overrides the
// detection.

export interface BrowserInfo {
  path: string;
  name: string; // "Google Chrome", "Chromium", "Microsoft Edge", "Brave", "Playwright Chromium", "AGENTPHOTO_CHROME"
  source: "env" | "system" | "playwright";
}

export interface DetectDeps {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  exists(path: string): boolean;
  readdir(path: string): string[];
}

const realDeps = (): DetectDeps => ({
  platform: process.platform,
  env: process.env,
  home: homedir(),
  exists: (p) => existsSync(p),
  readdir: (p) => {
    try {
      return readdirSync(p);
    } catch {
      return [];
    }
  },
});

export function browserCandidates(deps: DetectDeps): BrowserInfo[] {
  const { platform, env, home } = deps;
  const out: BrowserInfo[] = [];
  const sys = (name: string, path: string) => out.push({ name, path, source: "system" });
  if (platform === "darwin") {
    for (const root of ["/Applications", join(home, "Applications")]) {
      sys("Google Chrome", `${root}/Google Chrome.app/Contents/MacOS/Google Chrome`);
      sys("Chromium", `${root}/Chromium.app/Contents/MacOS/Chromium`);
      sys("Google Chrome Canary", `${root}/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary`);
      sys("Microsoft Edge", `${root}/Microsoft Edge.app/Contents/MacOS/Microsoft Edge`);
      sys("Brave", `${root}/Brave Browser.app/Contents/MacOS/Brave Browser`);
    }
  } else if (platform === "win32") {
    const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter((r): r is string => !!r);
    for (const r of roots) {
      sys("Google Chrome", join(r, "Google", "Chrome", "Application", "chrome.exe"));
      sys("Chromium", join(r, "Chromium", "Application", "chrome.exe"));
      sys("Microsoft Edge", join(r, "Microsoft", "Edge", "Application", "msedge.exe"));
      sys("Brave", join(r, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"));
    }
  } else {
    const names: [string, string][] = [
      ["google-chrome-stable", "Google Chrome"],
      ["google-chrome", "Google Chrome"],
      ["chromium", "Chromium"],
      ["chromium-browser", "Chromium"],
      ["microsoft-edge", "Microsoft Edge"],
      ["microsoft-edge-stable", "Microsoft Edge"],
      ["brave-browser", "Brave"],
    ];
    const dirs = [...(env.PATH ?? "").split(delimiter).filter(Boolean), "/usr/bin", "/usr/local/bin", "/snap/bin", "/opt/google/chrome"];
    const seen = new Set<string>();
    for (const [bin, name] of names)
      for (const d of dirs) {
        const p = join(d, bin);
        if (!seen.has(p)) {
          seen.add(p);
          sys(name, p);
        }
      }
    sys("Google Chrome", "/opt/google/chrome/chrome");
  }
  // Playwright's browser cache (`npx playwright install chromium`), newest first.
  const pwRoot = env.PLAYWRIGHT_BROWSERS_PATH || (platform === "darwin" ? join(home, "Library", "Caches", "ms-playwright") : platform === "win32" ? join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "ms-playwright") : join(home, ".cache", "ms-playwright"));
  const builds = deps
    .readdir(pwRoot)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const b of builds) {
    const base = join(pwRoot, b);
    const rel =
      platform === "darwin"
        ? ["chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"]
        : platform === "win32"
          ? ["chrome-win/chrome.exe", "chrome-win64/chrome.exe"]
          : ["chrome-linux/chrome", "chrome-linux64/chrome"];
    for (const r of rel) out.push({ name: "Playwright Chromium", path: join(base, ...r.split("/")), source: "playwright" });
  }
  return out;
}

export function findBrowser(deps: DetectDeps = realDeps()): BrowserInfo | null {
  const override = deps.env.AGENTPHOTO_CHROME;
  if (override) return deps.exists(override) ? { name: "AGENTPHOTO_CHROME", path: override, source: "env" } : null;
  return browserCandidates(deps).find((c) => deps.exists(c.path)) ?? null;
}

export function noBrowserError(): CliError {
  const override = process.env.AGENTPHOTO_CHROME;
  return new CliError(
    "no-browser",
    override ? `AGENTPHOTO_CHROME points at ${override}, which does not exist.` : "No Chrome, Chromium, Edge or Brave found on this computer (needed for headless renders).",
    override ? "Fix AGENTPHOTO_CHROME (the browser executable), or unset it to auto-detect." : "Install Google Chrome (https://www.google.com/chrome/) or run `npx playwright install chromium`, or set AGENTPHOTO_CHROME to a Chromium-based browser executable. `agentphoto doctor` re-checks.",
  );
}

export function requireBrowser(): BrowserInfo {
  const b = findBrowser();
  if (!b) throw noBrowserError();
  return b;
}

// `<browser> --version` ("Google Chrome 131.0.6778.85"). Not on Windows
// (the flag opens a window there): null.
export function browserVersion(path: string): Promise<string | null> {
  if (process.platform === "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(path, ["--version"], { timeout: 10_000 }, (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });
}

export const HEADLESS_ARGS = [
  "--headless=new",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--ignore-gpu-blocklist",
  "--remote-debugging-port=0",
  "--no-first-run",
  "--no-default-browser-check",
  "--hide-scrollbars",
  "--mute-audio",
  "--disable-extensions",
  "--disable-sync",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--autoplay-policy=no-user-gesture-required",
];

export interface LaunchedBrowser {
  info: BrowserInfo;
  wsUrl: string;
  process: ChildProcess;
  profileDir: string;
  close(): Promise<void>;
}

export function launchBrowser(info: BrowserInfo, opts: { timeoutMs?: number; extraArgs?: string[] } = {}): Promise<LaunchedBrowser> {
  sweepStaleProfiles();
  const profileDir = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  const args = [...HEADLESS_ARGS, `--user-data-dir=${profileDir}`, ...(isRoot() ? ["--no-sandbox"] : []), ...(opts.extraArgs ?? []), "about:blank"];
  const child = spawn(info.path, args, { stdio: ["ignore", "ignore", "pipe"] });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    process.off("exit", onExit);
    await killProcess(child);
    removeDir(profileDir);
  };
  // The CLI exiting without close() (an uncaught error, process.exit) must not
  // leave Chrome running or its profile behind.
  const onExit = () => {
    child.kill("SIGKILL");
    removeDir(profileDir);
  };
  process.once("exit", onExit);
  return new Promise((resolve, reject) => {
    let stderr = "";
    const fail = (message: string) => {
      clearTimeout(timer);
      void close().finally(() =>
        reject(
          new CliError("browser-launch", message, `Could not start ${info.name} (${info.path}) headless. Check it opens normally, close crash dialogs, or point AGENTPHOTO_CHROME at another Chromium-based browser. Stderr tail: ${stderr.trim().split("\n").slice(-3).join(" | ") || "(empty)"}`),
        ),
      );
    };
    const timer = setTimeout(() => fail(`${info.name} did not report its DevTools endpoint within ${Math.round((opts.timeoutMs ?? 20_000) / 1000)} s.`), opts.timeoutMs ?? 20_000);
    child.on("error", (e) => fail(`Failed to start the browser: ${e.message}`));
    child.on("exit", (code) => {
      if (!wsFound) fail(`${info.name} exited (code ${code}) before it was ready.`);
    });
    let wsFound = false;
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      if (wsFound) return;
      stderr += chunk;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(stderr);
      if (m) {
        wsFound = true;
        clearTimeout(timer);
        // Keep draining stderr so the pipe never fills up.
        child.stderr!.resume();
        resolve({ info, wsUrl: m[1], process: child, profileDir, close });
      }
    });
  });
}

function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function killProcess(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const done = () => {
      clearTimeout(hard);
      resolve();
    };
    child.once("exit", done);
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    const hard = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      setTimeout(resolve, 200);
    }, 2000);
  });
}

const PROFILE_PREFIX = "agentphoto-chrome-";
const STALE_PROFILE_MS = 24 * 3600_000;

// Profiles left by a killed process (Ctrl-C, a crash): removed by the next
// launch once they are a day old, so a render still running elsewhere keeps its own.
function sweepStaleProfiles(): void {
  try {
    const now = Date.now();
    for (const name of readdirSync(tmpdir())) {
      if (!name.startsWith(PROFILE_PREFIX)) continue;
      const dir = join(tmpdir(), name);
      if (now - statSync(dir).mtimeMs > STALE_PROFILE_MS) removeDir(dir);
    }
  } catch {
    /* best effort */
  }
}

function removeDir(dir: string): void {
  // Chrome may still hold files for a moment after exit (Windows): retry.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* best effort: it's in the temp folder */
  }
}
