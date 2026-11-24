// Takes the guide's screenshots (site/img/<lang>/<name>.jpg, 1600×1000) from the
// built site, in English and French: real projects made with the CLI, opened in
// the Studio through #import, set up with the deep-link params
// (src/studio/lib/urlState.ts), captured by headless Chrome over CDP at
// 1440×900 ×2. See site/README.md "Screenshots".
//
//   node site/screenshots.mjs --base http://127.0.0.1:8765 --projects <dir> [--only editor,looks] [--lang en]
//
// <dir> holds the CLI projects named below (thumb, product, sale, lake, city, cat).
// The site root must be dist/site (the bundles are written to dist/site/_shots/
// for the capture and removed after). macOS `sips` makes the JPEGs.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : def);
const base = opt("base", "http://127.0.0.1:8765");
const projects = resolve(opt("projects", ""));
const only = opt("only", "")?.split(",").filter(Boolean) ?? [];
const langs = opt("lang", "en,fr").split(",");
const CHROME = process.env.AGENTPHOTO_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// name → project, deep-link params, optional steps run before the capture.
const SHOTS = [
  { name: "editor", project: "thumb", params: "select=title&panel=properties" },
  { name: "cutout", project: "product", params: "select=photo&panel=properties", scrollTo: "mask" },
  { name: "filters", project: "lake", params: "select=photo&panel=filters", expand: /^(Curves|Courbes)$/ },
  { name: "looks", project: "city", params: "select=photo&panel=looks" },
  { name: "text", project: "sale", params: "select=title&panel=effects" },
  { name: "export", project: "thumb", params: "dialog=export" },
  { name: "ai-select", project: "cat", params: "select=photo&tool=quick", quickSelect: [0.33, 0.55] },
  { name: "start", project: null, params: "start=1" },
];

// The project folder as an agentphoto bundle (docs/studio.md), without renders/ and dist/.
function bundle(dir) {
  const files = {};
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      const rel = relative(dir, p);
      if (f === ".DS_Store" || rel === "renders" || rel === "dist") continue;
      if (statSync(p).isDirectory()) walk(p);
      else files[rel] = readFileSync(p).toString("base64");
    }
  };
  walk(dir);
  const title = JSON.parse(readFileSync(join(dir, "agentphoto.json"), "utf8")).title ?? "Project";
  return JSON.stringify({ format: "agentphoto-project", version: 1, title, files });
}

const shotsDir = join(root, "dist", "site", "_shots");
mkdirSync(shotsDir, { recursive: true });
for (const p of new Set(SHOTS.map((s) => s.project).filter(Boolean))) writeFileSync(join(shotsDir, `${p}.json`), bundle(join(projects, p)));

async function chrome() {
  const profile = mkdtempSync(join(tmpdir(), "ap-site-shot-"));
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
  const portFile = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(50);
  await sleep(100);
  const port = readFileSync(portFile, "utf8").split("\n")[0];
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
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
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
    return r.result.value;
  };
  const navigate = async (url) => {
    await send("Page.navigate", { url });
    for (let i = 0; i < 400; i++) {
      await sleep(50);
      if ((await evaluate("document.readyState").catch(() => "")) === "complete") break;
    }
  };
  const waitFor = async (expr, ms = 60000) => {
    for (let t = 0; t < ms; t += 200) {
      if (await evaluate(expr).catch(() => false)) return true;
      await sleep(200);
    }
    throw new Error(`timeout: ${expr}`);
  };
  const click = async (x, y, modifiers = 0) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers });
  };
  const capture = async (file) => {
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(r.data, "base64"));
  };
  const close = () => {
    ws.close();
    proc.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true, maxRetries: 5 }), 500).unref?.();
  };
  return { evaluate, navigate, waitFor, click, capture, close };
}

const toJpeg = (png, jpg) => {
  mkdirSync(dirname(jpg), { recursive: true });
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "82", "-z", "1000", "1600", png, "--out", jpg], { stdio: "ignore" });
  rmSync(png);
};

try {
  for (const lang of langs) {
    const c = await chrome();
    const ids = {};
    let n = 0;
    try {
      // Import every project once (the browser keeps them: Recent on the start screen).
      for (const p of new Set(SHOTS.map((s) => s.project).filter(Boolean))) {
        await c.navigate(`${base}/?lang=${lang}&n=${++n}#import=/_shots/${p}.json`);
        await c.waitFor("/[?&]project=/.test(location.search)");
        ids[p] = await c.evaluate("new URLSearchParams(location.search).get('project')");
        await sleep(800);
      }
      for (const s of SHOTS) {
        if (only.length && !only.includes(s.name)) continue;
        const q = s.project ? `project=${encodeURIComponent(ids[s.project])}&${s.params}` : s.params;
        await c.navigate(`${base}/?lang=${lang}&events=0&${q}`);
        await c.evaluate("document.fonts.ready.then(() => true)");
        await sleep(2500);
        if (s.scrollTo === "mask") {
          await c.evaluate(`(() => { const h = [...document.querySelectorAll("button, h3, div")].find((e) => /^(Mask|Masque)$/.test(e.textContent.trim())); h?.scrollIntoView({ block: "start" }); return !!h; })()`);
          await sleep(500);
        }
        if (s.expand) {
          // Open one filter card (its header button), e.g. the curve editor.
          await c.evaluate(`(() => { const e = [...document.querySelectorAll("button, span, div")].find((n) => ${s.expand}.test(n.textContent.trim()) && n.children.length === 0); e?.click(); return !!e; })()`);
          await sleep(800);
        }
        if (s.quickSelect) {
          // Click the subject (fractions of the canvas box); accept the one-time model download.
          const box = await c.evaluate(`(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
          await c.click(box[0] + box[2] * s.quickSelect[0], box[1] + box[3] * s.quickSelect[1]);
          await sleep(1500);
          await c.evaluate(`(() => { const b = [...document.querySelectorAll("[role=dialog] button")].pop(); b?.click(); return !!b; })()`);
          await sleep(3000);
          await c.waitFor(`!/(Downloading|Téléchargement de) slimsam|Running the model|Exécution du modèle|Segmenting|Segmentation…/.test(document.body.innerText)`, 300000);
          await sleep(5000);
        }
        const png = join(tmpdir(), `ap-${lang}-${s.name}.png`);
        await c.capture(png);
        toJpeg(png, join(root, "site", "img", lang, `${s.name}.jpg`));
        console.log(`[shots] site/img/${lang}/${s.name}.jpg`);
      }
    } finally {
      c.close();
    }
  }
} finally {
  rmSync(shotsDir, { recursive: true, force: true });
}
