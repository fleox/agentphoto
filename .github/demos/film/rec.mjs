// CDP driver: node rec.mjs <url> <steps.mjs> <outdir> [--size 1920x1080] [--gpu]
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [url, stepsFile, outDir] = args;
const [W, H] = opt("size", "1920x1080").split("x").map(Number);
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "a3d-rec-"));
const gl = args.includes("--gpu") ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...gl, "--hide-scrollbars", "--no-first-run",
   "--no-default-browser-check", "--lang=en-US", "--force-color-profile=srgb", `--window-size=${W},${H}`, "about:blank"],
  { stdio: ["ignore", "ignore", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let port;
for (let i = 0; i < 200 && !port; i++) { const f = join(profile, "DevToolsActivePort"); if (existsSync(f)) port = readFileSync(f, "utf8").split("\n")[0]; await sleep(50); }
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0; const pending = new Map(); const listeners = [];
ws.addEventListener("message", (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
  else if (m.method) listeners.forEach((l) => l(m)); });
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
const navigate = async (u) => { await send("Page.navigate", { url: u }); for (let i = 0; i < 400; i++) { await sleep(50); try { if ((await evaluate("document.readyState")) === "complete") break; } catch {} } };
const CURSOR = `(() => { if (document.getElementById('__cur')) return; const d = document.createElement('div'); d.id='__cur';
 d.style.cssText='position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))';
 d.innerHTML='<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.6 L14.4 20.4 L11.3 13.7 L17.5 13.4 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
 document.documentElement.appendChild(d);
 const r = document.createElement('div'); r.id='__ring'; r.style.cssText='position:fixed;left:0;top:0;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:3px solid #7aa5ff;z-index:2147483646;pointer-events:none;opacity:0;transition:opacity .35s, transform .35s;transform:scale(.4)'; document.documentElement.appendChild(r);
 window.__curMove=(x,y)=>{d.style.transform='translate('+(x-4)+'px,'+(y-2)+'px)';};
 window.__curClick=(x,y)=>{r.style.left=x+'px';r.style.top=y+'px';r.style.transition='none';r.style.opacity='1';r.style.transform='scale(.4)';r.offsetWidth;r.style.transition='opacity .45s, transform .45s';r.style.opacity='0';r.style.transform='scale(1.3)';};
})()`;
let cx = W / 2, cy = H / 2;
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });
const ensureCursor = () => evaluate(CURSOR);
const moveTo = async (x, y, ms = 600, held = false) => { await ensureCursor(); const n = Math.max(1, Math.round(ms / 50)); const x0 = cx, y0 = cy;
  for (let i = 1; i <= n; i++) { const t = i / n; const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; const px = x0 + (x - x0) * e, py = y0 + (y - y0) * e;
    await mouse("mouseMoved", px, py, held ? { buttons: 1 } : { button: "none" }); await evaluate(`__curMove(${px},${py})`); }
  cx = x; cy = y; };
const click = async (x, y, ms = 600) => { await moveTo(x, y, ms); await evaluate(`__curClick(${x},${y})`); await mouse("mousePressed", x, y); await sleep(60); await mouse("mouseReleased", x, y); };
const drag = async (x1, y1, x2, y2, ms = 1200) => { await moveTo(x1, y1, 500); await mouse("mousePressed", x1, y1, { buttons: 1 }); await sleep(120); await moveTo(x2, y2, ms, true); await sleep(80); await mouse("mouseReleased", x2, y2); };
const shot = async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(resolve(outDir, file), Buffer.from(r.data, "base64")); };
// screencast recording
const frames = []; let recording = false;
listeners.push(async (m) => { if (m.method === "Page.screencastFrame") { const { data, metadata, sessionId } = m.params;
  send("Page.screencastFrameAck", { sessionId }); if (recording) frames.push({ t: metadata.timestamp, data }); } });
const startRec = async () => { recording = true; await send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 }); };
const stopRec = async (name) => { await send("Page.stopScreencast"); recording = false; const dir = resolve(outDir, name); mkdirSync(dir, { recursive: true });
  let list = ""; frames.forEach((f, i) => { const fn = `f${String(i).padStart(5, "0")}.jpg`; writeFileSync(join(dir, fn), Buffer.from(f.data, "base64"));
    const d = i + 1 < frames.length ? frames[i + 1].t - f.t : 0.04; list += `file '${fn}'\nduration ${d.toFixed(4)}\n`; });
  list += `file 'f${String(frames.length - 1).padStart(5, "0")}.jpg'\n`; writeFileSync(join(dir, "list.txt"), list); console.error("frames", frames.length, "span", frames.length ? frames.at(-1).t - frames[0].t : 0); frames.length = 0; };
try { await navigate(url); const mod = await import(pathToFileURL(resolve(stepsFile)).href);
  await mod.default({ evaluate, sleep, click, moveTo, drag, mouse, shot, send, navigate, startRec, stopRec, ensureCursor, key: async (k, code = k, mods = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, modifiers: mods }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, modifiers: mods }); } });
} finally { ws.close(); chrome.kill("SIGTERM"); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
