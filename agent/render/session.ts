import { statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EncodedImage, EngineHost, SegmentPrompt } from "../../src/ai/types";
import type { PhotoDoc } from "../../src/core/types";
import type { ImageStats } from "../../src/engine/analyze";
import type { ExportJob } from "../../src/ops/export";
import { referencedFiles } from "../../src/ops/tree";
import { readLibraryIndex } from "../host";
import { CliError } from "../output";
import { engineBuilt, engineDir, libraryDir } from "../paths";
import { launchBrowser, requireBrowser, type LaunchedBrowser } from "./browser";
import { CdpClient, CdpError, type CdpSession } from "./cdp";
import { modelsRoute } from "./models";
import { ENGINE_PAGE, enginePageHtml, PROGRESS_TAG } from "./page";
import { sendText, startLocalServer, type LocalServer } from "./server";

// The headless engine: one Chrome + one local server + one page running
// window.agentphoto (src/engine/headless.ts), started lazily on the first
// call and reused for the whole process (MCP and the Studio server keep it
// warm). Calls go through CDP Runtime.evaluate with JSON-embedded arguments;
// images come back as { base64 } and are decoded to bytes. A crashed page or
// browser is restarted on the next call; Chrome dies with the process.

export type EngineMethod = "render" | "exportImage" | "analyze" | "backgroundMask" | "segmentMask" | "colorRangeMask" | "layerBoxes" | "invalidate";

const AI_METHODS = new Set<EngineMethod>(["backgroundMask", "segmentMask"]);
const CALL_TIMEOUT_MS = Number(process.env.AGENTPHOTO_CDP_TIMEOUT_MS) || 180_000;
// AI calls may download a model first (tens of MB).
const AI_TIMEOUT_MS = Math.max(CALL_TIMEOUT_MS, 15 * 60_000);
const READY_TIMEOUT_MS = 30_000;

interface Live {
  browser: LaunchedBrowser;
  client: CdpClient;
  page: CdpSession;
  server: LocalServer;
  dead: boolean;
}

export interface EngineSessionOptions {
  log?(message: string): void;
}

export interface EncodedB64 {
  base64: string;
  mime: string;
  width: number;
  height: number;
  errors?: { layer: string; message: string }[];
  bbox?: EncodedImage["bbox"];
  [extra: string]: unknown;
}

// { base64, … } → { bytes, … }: every other field (mime, size, errors, bbox, scale…) is kept.
export function decodeImage(r: EncodedB64): EncodedImage {
  const { base64, errors, ...rest } = r;
  return { ...rest, bytes: new Uint8Array(Buffer.from(base64, "base64")), ...(errors?.length ? { errors } : {}) } as EncodedImage;
}

export class EngineSession {
  readonly projectDir: string;
  private live: Promise<Live> | null = null;
  private stamps = new Map<string, string>();
  private log: (message: string) => void;
  private consoleErrors: string[] = [];
  private progress = { label: "", pct: -1, at: 0 };

  constructor(projectDir: string, opts: EngineSessionOptions = {}) {
    this.projectDir = resolve(projectDir);
    this.log = opts.log ?? ((m) => void process.stderr.write(`${m}\n`));
  }

  get started(): boolean {
    return this.live !== null;
  }

  private start(): Promise<Live> {
    if (!engineBuilt())
      return Promise.reject(new CliError("engine-missing", `The engine build is missing (${join(engineDir(), "agentphoto-engine.js")}).`, "Use the npm package (it ships dist/engine), or run `npm run build:engine` in a clone. AGENTPHOTO_DIST can point at another dist/ folder."));
    let info;
    try {
      info = requireBrowser();
    } catch (e) {
      return Promise.reject(e);
    }
    const p = (async (): Promise<Live> => {
      const html = enginePageHtml({ library: readLibraryIndex() });
      const server = await startLocalServer({
        mounts: { "/__engine/": engineDir(), "/__library/": libraryDir(), "/project/": this.projectDir },
        routes: [(_req, res, url) => (url.pathname === ENGINE_PAGE ? (sendText(res, 200, html, "text/html; charset=utf-8"), true) : false), modelsRoute({ log: this.log })],
      });
      let browser: LaunchedBrowser | null = null;
      try {
        browser = await launchBrowser(info);
        const client = await CdpClient.connect(browser.wsUrl);
        const page = await client.newPage();
        const live: Live = { browser, client, page, server, dead: false };
        const kill = () => {
          live.dead = true;
        };
        browser.process.once("exit", kill);
        page.on("Inspector.targetCrashed", kill);
        page.on("Runtime.consoleAPICalled", (e) => this.onConsole(e));
        page.on("Runtime.exceptionThrown", (e) => this.remember(`exception: ${JSON.stringify((e as { exceptionDetails?: unknown }).exceptionDetails ?? e).slice(0, 400)}`));
        await page.send("Runtime.enable");
        await page.send("Inspector.enable").catch(() => undefined);
        await page.send("Page.enable");
        await page.send("Page.navigate", { url: `${server.url}${ENGINE_PAGE}` });
        const t0 = Date.now();
        for (;;) {
          const state = await page.evaluate<number | string>("window.__agentphotoReady ? 1 : window.__agentphotoError ? String(window.__agentphotoError) : 0", 10_000).catch(() => 0);
          if (state === 1) break;
          if (typeof state === "string") throw new CliError("engine-init", `The engine page failed to start: ${state.split("\n")[0]}`, "Rebuild the engine (`npm run build:engine` in a clone) or reinstall the package; `agentphoto doctor` checks the setup.");
          if (Date.now() - t0 > READY_TIMEOUT_MS) throw new CliError("engine-init", `The engine page did not start within ${READY_TIMEOUT_MS / 1000} s.${this.consoleErrors.length ? ` Console: ${this.consoleErrors.slice(-3).join(" | ")}` : ""}`, "Retry once; then run `agentphoto doctor`.");
          await new Promise((r) => setTimeout(r, 100));
        }
        this.stamps.clear();
        return live;
      } catch (e) {
        await browser?.close().catch(() => undefined);
        await server.close().catch(() => undefined);
        throw e;
      }
    })();
    return p;
  }

  private remember(line: string): void {
    this.consoleErrors.push(line);
    if (this.consoleErrors.length > 20) this.consoleErrors.shift();
    if (process.env.AGENTPHOTO_DEBUG) this.log(`[engine] ${line}`);
  }

  private onConsole(e: Record<string, unknown>): void {
    const args = (e.args as { value?: unknown; description?: string }[] | undefined) ?? [];
    const text = args.map((a) => (typeof a.value === "string" ? a.value : a.value !== undefined ? JSON.stringify(a.value) : (a.description ?? ""))).join(" ");
    if (text.startsWith(PROGRESS_TAG)) {
      let p: { label?: string; progress?: number; model?: string };
      try {
        p = JSON.parse(text.slice(PROGRESS_TAG.length));
      } catch {
        return;
      }
      this.onProgress(p);
      return;
    }
    if (e.type === "error" || e.type === "warning") this.remember(`${e.type}: ${text.slice(0, 400)}`);
    else if (process.env.AGENTPHOTO_DEBUG) this.log(`[engine] ${text.slice(0, 400)}`);
  }

  // Throttled: a line per 10 % (or every 2 s), plus the phase changes.
  private onProgress(p: { label?: string; progress?: number; model?: string }): void {
    const label = p.label ?? "";
    const phase = label.replace(/\s*\(\d+\s*%\)$/, "");
    const pct = Math.round((p.progress ?? 0) * 100);
    const now = Date.now();
    const last = this.progress;
    const samePhase = last.label === phase;
    if (samePhase && pct < 100 && pct - last.pct < 10 && now - last.at < 2000) return;
    if (samePhase && pct === last.pct) return;
    if (/ready$/.test(phase) && samePhase) return;
    this.progress = { label: phase, pct, at: now };
    this.log(label);
  }

  private async ensure(): Promise<Live> {
    if (this.live) {
      const live = await this.live.catch(() => null);
      if (live && !live.dead) return live;
      if (live) await this.dispose(live);
      this.live = null;
    }
    this.live = this.start();
    this.live.catch(() => (this.live = null));
    return this.live;
  }

  private async dispose(live: Live): Promise<void> {
    live.dead = true;
    live.client.close();
    await live.browser.close().catch(() => undefined);
    await live.server.close().catch(() => undefined);
  }

  // Files of the document that changed on disk since the page last saw them
  // (a regenerated mask under the same name, a Studio edit): invalidated so
  // the warm page reloads them.
  private async sync(live: Live, doc: unknown): Promise<void> {
    if (!doc || typeof doc !== "object" || !Array.isArray((doc as PhotoDoc).layers)) return;
    const changed: string[] = [];
    for (const { path } of referencedFiles(doc as PhotoDoc)) {
      if (!path || path.startsWith("library:") || /^(blob:|data:)/.test(path)) continue;
      let stamp = "missing";
      try {
        const s = statSync(join(this.projectDir, path));
        stamp = `${s.size}:${s.mtimeMs}`;
      } catch {
        /* missing: the render reports it */
      }
      const prev = this.stamps.get(path);
      if (prev !== undefined && prev !== stamp) changed.push(path);
      this.stamps.set(path, stamp);
    }
    if (changed.length) await live.page.evaluate(`window.agentphoto.invalidate ? window.agentphoto.invalidate(${JSON.stringify(changed)}) : 0`, 10_000).catch(() => undefined);
  }

  // Runs window.agentphoto[method](...args) in the page.
  async call<T = unknown>(method: EngineMethod, ...args: unknown[]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const live = await this.ensure();
      try {
        await this.sync(live, args[0]);
        const expr = `window.agentphoto.${method}(...${JSON.stringify(args)})`;
        return await live.page.evaluate<T>(expr, AI_METHODS.has(method) ? AI_TIMEOUT_MS : CALL_TIMEOUT_MS);
      } catch (e) {
        // The browser or the page died: restart once (engine calls are pure).
        if (live.dead || (e instanceof CdpError && /connection closed|crashed|Target closed|No target|Session/i.test(e.message))) {
          await this.dispose(live);
          this.live = null;
          if (attempt === 0) {
            this.log("[engine] the headless browser stopped — restarting it");
            continue;
          }
          throw new CliError("engine-crashed", `The headless browser stopped during ${method}.`, "Retry; a very large image may exhaust memory (reduce the size), otherwise run `agentphoto doctor`.");
        }
        throw this.engineError(method, e);
      }
    }
  }

  private engineError(method: EngineMethod, e: unknown): CliError {
    if (e instanceof CliError) return e;
    const raw = e instanceof Error ? e.message : String(e);
    const message = raw.replace(/^Runtime\.evaluate:\s*/, "").split("\n")[0].replace(/^(Uncaught\s+)?(Error:\s*)?/, "");
    if (/no answer within/.test(raw)) return new CliError("engine-timeout", `The engine did not answer ${method} in time.`, "Retry (a model download may be slow); AGENTPHOTO_CDP_TIMEOUT_MS raises the limit.");
    const ai = AI_METHODS.has(method);
    if (ai && /fetch|network|HTTP|Failed to load|download|onnx|wasm|protobuf/i.test(raw))
      return new CliError("model-unavailable", `The AI model could not be loaded: ${message}`, "The first use downloads the model once from huggingface.co: check the network, then retry (`agentphoto models pull <id>` pre-downloads; `agentphoto models list` shows the cache).", 1, this.consoleErrors.length ? { console: this.consoleErrors.slice(-5) } : undefined);
    return new CliError("engine", `${method} failed in the engine: ${message}`, ai ? "Check the layer is an image with visible pixels; `agentphoto layer list` shows the layers." : "Check the document (`agentphoto check`): a missing file or an invalid layer is the usual cause.", 1, this.consoleErrors.length ? { console: this.consoleErrors.slice(-5) } : undefined);
  }

  async close(): Promise<void> {
    const p = this.live;
    this.live = null;
    if (!p) return;
    const live = await p.catch(() => null);
    if (live) await this.dispose(live);
  }
}

// ─── one session per project folder, per process ────────────────────────

const sessions = new Map<string, EngineSession>();

export function engineSession(projectDir: string): EngineSession {
  const key = resolve(projectDir);
  let s = sessions.get(key);
  if (!s) sessions.set(key, (s = new EngineSession(key)));
  return s;
}

export async function closeEngineSessions(): Promise<void> {
  const all = [...sessions.values()];
  sessions.clear();
  await Promise.all(all.map((s) => s.close()));
}

// The EngineHost of src/ai/types.ts over a session.
export function sessionEngineHost(session: () => EngineSession): EngineHost {
  return {
    async render(doc, opts) {
      return decodeImage(await session().call<EncodedB64>("render", doc, opts));
    },
    async exportImage(doc: PhotoDoc, job: ExportJob) {
      return decodeImage(await session().call<EncodedB64>("exportImage", doc, job));
    },
    analyze(doc, opts) {
      return session().call<ImageStats>("analyze", doc, opts);
    },
    async backgroundMask(doc, id, opts) {
      return decodeImage(await session().call<EncodedB64>("backgroundMask", doc, id, opts));
    },
    async segmentMask(doc, id, prompt: SegmentPrompt, opts) {
      return decodeImage(await session().call<EncodedB64>("segmentMask", doc, id, prompt, opts));
    },
    async colorRangeMask(doc, id, opts) {
      return decodeImage(await session().call<EncodedB64>("colorRangeMask", doc, id, opts));
    },
    layerBoxes(doc) {
      return session().call("layerBoxes", doc);
    },
  };
}
