import { describe, expect, it } from "vitest";
import { browserCandidates, findBrowser, type DetectDeps } from "./browser";

const deps = (platform: NodeJS.Platform, files: string[], env: Record<string, string> = {}, dirs: Record<string, string[]> = {}): DetectDeps => ({
  platform,
  env,
  home: platform === "win32" ? "C:\\Users\\me" : platform === "darwin" ? "/Users/me" : "/home/me",
  exists: (p) => files.includes(p),
  readdir: (p) => dirs[p] ?? [],
});

describe("browser detection", () => {
  it("finds Chrome first on macOS, then Edge / Brave", () => {
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const edge = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    expect(findBrowser(deps("darwin", [edge, chrome]))).toMatchObject({ name: "Google Chrome", path: chrome, source: "system" });
    expect(findBrowser(deps("darwin", [edge]))).toMatchObject({ name: "Microsoft Edge" });
    expect(findBrowser(deps("darwin", ["/Users/me/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"]))).toMatchObject({ name: "Brave" });
    expect(findBrowser(deps("darwin", []))).toBeNull();
  });

  it("searches PATH on Linux and the Playwright cache, newest build first", () => {
    expect(findBrowser(deps("linux", ["/opt/bin/chromium"], { PATH: "/opt/bin:/usr/bin" }))).toMatchObject({ name: "Chromium", path: "/opt/bin/chromium" });
    const pw = deps("linux", ["/home/me/.cache/ms-playwright/chromium-1140/chrome-linux/chrome", "/home/me/.cache/ms-playwright/chromium-1100/chrome-linux/chrome"], {}, { "/home/me/.cache/ms-playwright": ["chromium-1100", "chromium-1140", "firefox-1"] });
    expect(findBrowser(pw)).toMatchObject({ source: "playwright", path: "/home/me/.cache/ms-playwright/chromium-1140/chrome-linux/chrome" });
  });

  it("looks in Program Files on Windows", () => {
    const env = { PROGRAMFILES: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" };
    const paths = browserCandidates(deps("win32", [], env)).map((c) => c.path);
    expect(paths.some((p) => p.includes("Google") && p.endsWith("chrome.exe"))).toBe(true);
    expect(paths.some((p) => p.endsWith("msedge.exe"))).toBe(true);
  });

  it("AGENTPHOTO_CHROME overrides the detection", () => {
    expect(findBrowser(deps("linux", ["/x/chrome"], { AGENTPHOTO_CHROME: "/x/chrome" }))).toEqual({ name: "AGENTPHOTO_CHROME", path: "/x/chrome", source: "env" });
    expect(findBrowser(deps("linux", ["/usr/bin/chromium"], { AGENTPHOTO_CHROME: "/missing", PATH: "/usr/bin" }))).toBeNull();
  });
});
