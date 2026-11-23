import { CliError } from "../output";

// Minimal Chrome DevTools Protocol client over Node's global WebSocket
// (Node ≥ 22; no dependency). One connection to the browser endpoint;
// page sessions via Target.attachToTarget({ flatten: true }), messages
// carry their sessionId.

type Handler = (params: Record<string, unknown>) => void;

interface Pending {
  resolve(v: unknown): void;
  reject(e: Error): void;
  method: string;
}

// Per-call answer timeout; $AGENTPHOTO_CDP_TIMEOUT_MS raises it on slow machines (CI runners with software GL).
const DEFAULT_TIMEOUT_MS = Number(process.env.AGENTPHOTO_CDP_TIMEOUT_MS) || 60_000;

export class CdpError extends Error {
  override name = "CdpError";
  constructor(
    readonly method: string,
    message: string,
  ) {
    super(`${method}: ${message}`);
  }
}

export interface CdpTarget {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  on(event: string, handler: Handler): () => void;
  waitFor(event: string, predicate?: (params: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
}

export class CdpClient implements CdpTarget {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private handlers = new Map<string, Set<Handler>>();
  private closed = false;

  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (ev) => this.onMessage(String((ev as MessageEvent).data)));
    ws.addEventListener("close", () => this.onClose());
    ws.addEventListener("error", () => this.onClose());
  }

  static connect(url: string, timeoutMs = 10_000): Promise<CdpClient> {
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) return Promise.reject(new CliError("node-too-old", `Headless renders need Node 22 or newer (global WebSocket); this is Node ${process.versions.node}.`, "Upgrade Node (https://nodejs.org) — `agentphoto doctor` checks it."));
    return new Promise((resolve, reject) => {
      const ws = new WS(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new CliError("cdp-connect", `Could not connect to the browser DevTools endpoint (${url}).`, "Retry; if it persists run `agentphoto doctor`."));
      }, timeoutMs);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new CliError("cdp-connect", `Could not connect to the browser DevTools endpoint (${url}).`, "Retry; if it persists run `agentphoto doctor`."));
      });
    });
  }

  private onMessage(text: string): void {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string }; sessionId?: string };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new CdpError(p.method, msg.error.message));
      else p.resolve(msg.result ?? {});
      return;
    }
    if (msg.method) {
      const key = msg.sessionId ? `${msg.sessionId}:${msg.method}` : msg.method;
      for (const h of this.handlers.get(key) ?? []) h(msg.params ?? {});
    }
  }

  private onClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new CdpError(p.method, "connection closed"));
    this.pending.clear();
  }

  rawSend<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (this.closed) return Promise.reject(new CdpError(method, "connection closed"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CdpError(method, `no answer within ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  rawOn(key: string, handler: Handler): () => void {
    let set = this.handlers.get(key);
    if (!set) this.handlers.set(key, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    return this.rawSend<T>(method, params, undefined, timeoutMs);
  }

  on(event: string, handler: Handler): () => void {
    return this.rawOn(event, handler);
  }

  waitFor(event: string, predicate?: (p: Record<string, unknown>) => boolean, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    return waitForEvent(this, event, predicate, timeoutMs);
  }

  session(sessionId: string): CdpSession {
    return new CdpSession(this, sessionId);
  }

  // A new page target, attached (flattened) — the session drives it.
  async newPage(): Promise<CdpSession> {
    const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const s = this.session(sessionId);
    s.targetId = targetId;
    return s;
  }

  close(): void {
    this.onClose();
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

export class CdpSession implements CdpTarget {
  targetId?: string;
  constructor(
    readonly client: CdpClient,
    readonly sessionId: string,
  ) {}
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    return this.client.rawSend<T>(method, params, this.sessionId, timeoutMs);
  }
  on(event: string, handler: Handler): () => void {
    return this.client.rawOn(`${this.sessionId}:${event}`, handler);
  }
  waitFor(event: string, predicate?: (p: Record<string, unknown>) => boolean, timeoutMs = 30_000): Promise<Record<string, unknown>> {
    return waitForEvent(this, event, predicate, timeoutMs);
  }

  // Runtime.evaluate with awaitPromise + returnByValue; page exceptions
  // become errors.
  async evaluate<T = unknown>(expression: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const r = await this.send<{ result: { value?: unknown }; exceptionDetails?: { text?: string; exception?: { description?: string } } }>(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      timeoutMs,
    );
    if (r.exceptionDetails) throw new CdpError("Runtime.evaluate", r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "exception");
    return r.result.value as T;
  }
}

function waitForEvent(target: CdpTarget, event: string, predicate: ((p: Record<string, unknown>) => boolean) | undefined, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new CdpError(event, `event not received within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    const off = target.on(event, (p) => {
      if (predicate && !predicate(p)) return;
      clearTimeout(timer);
      off();
      resolve(p);
    });
  });
}
