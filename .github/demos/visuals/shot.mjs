// Minimal headless-Chrome screenshot driver over CDP (Node >= 22, global WebSocket).
// Usage: node shot.mjs <url> <out.png> [--size 1800x900] [--scale 2] [--wait 500]
//        [--storage '{"key":"value"}'] [--steps steps.mjs] [--full]
// --steps: an ES module whose default export is async ({ evaluate, wait, click, key, shot }) => void,
//          used to drive the Studio before (or between) screenshots.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const [url, out] = args;
const [W, H] = opt("size", "1800x900").split("x").map(Number);
const scale = Number(opt("scale", "2"));
const waitMs = Number(opt("wait", "600"));
const storage = JSON.parse(opt("storage", "null") ?? "null");
const stepsFile = opt("steps", null);

const CHROME =
  process.env.AGENTPHOTO_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const profile = mkdtempSync(join(tmpdir(), "ap-shot-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--lang=en-US",
    "--force-color-profile=srgb",
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function devtoolsPort() {
  const f = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 200; i++) {
    if (existsSync(f)) {
      const [port] = readFileSync(f, "utf8").split("\n");
      if (port) return port;
    }
    await sleep(50);
  }
  throw new Error("Chrome did not start");
}

const port = await devtoolsPort();
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: W,
  height: H,
  deviceScaleFactor: scale,
  mobile: false,
});
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
  return r.result.value;
};
const navigate = async (u) => {
  await send("Page.navigate", { url: u });
  for (let i = 0; i < 400; i++) {
    await sleep(50);
    try {
      if ((await evaluate("document.readyState")) === "complete") break;
    } catch {}
  }
};

if (storage) {
  // Set localStorage on the origin first, then load the real page.
  const origin = new URL(url).origin;
  await navigate(origin + "/__nothing__");
  await evaluate(
    `(() => { const s = ${JSON.stringify(storage)}; for (const k in s) localStorage.setItem(k, s[k]); })()`,
  );
}
await navigate(url);
await evaluate("document.fonts && document.fonts.ready.then(() => true)");
await sleep(waitMs);

const shot = async (file, clip) => {
  const r = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: flag("full"),
    ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
  });
  writeFileSync(resolve(file), Buffer.from(r.data, "base64"));
  console.error("wrote", file);
};
const mouse = async (type, x, y, extra = {}) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
const click = async (x, y) => {
  await mouse("mouseMoved", x, y, { button: "none" });
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
};
const key = async (k, code = k, mods = 0) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, modifiers: mods });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, modifiers: mods });
};

try {
  if (stepsFile) {
    const mod = await import(pathToFileURL(resolve(stepsFile)).href);
    await mod.default({ evaluate, wait: sleep, click, mouse, key, shot, send, navigate, out });
  } else {
    await shot(out);
  }
} finally {
  ws.close();
  chrome.kill("SIGTERM");
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
