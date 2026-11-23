// Live viewport rendering: the current document rendered in the page by the
// engine's compositor (per-layer cache) at viewport resolution. Requests are
// coalesced on animation frames; one render runs at a time and the latest
// request wins.

import type { PhotoDoc } from "../../core/types";
import type { AnyCanvas, Engine } from "../../engine";

export interface RenderRequest {
  doc: PhotoDoc;
  scale: number;
  skip?: ReadonlySet<string>;
  only?: ReadonlySet<string>;
}

export interface Frame {
  canvas: AnyCanvas;
  scale: number;
  ms: number;
  errors: { layer: string; message: string }[];
}

export class LiveRenderer {
  private pending: RenderRequest | null = null;
  private running = false;
  private raf = 0;
  private disposed = false;

  constructor(
    private engine: Engine,
    private onFrame: (f: Frame) => void,
  ) {}

  request(req: RenderRequest): void {
    this.pending = req;
    if (this.running || this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      void this.run();
    });
  }

  private async run(): Promise<void> {
    const req = this.pending;
    if (!req || this.disposed) return;
    this.pending = null;
    this.running = true;
    const t0 = performance.now();
    const errors: Frame["errors"] = [];
    try {
      const canvas = await this.engine.render(req.doc, { scale: req.scale, skip: req.skip, only: req.only, onError: (layer, message) => errors.push({ layer, message }) });
      if (!this.disposed) this.onFrame({ canvas, scale: req.scale, ms: performance.now() - t0, errors });
    } catch (e) {
      if (!this.disposed) this.onFrame({ canvas: null as unknown as AnyCanvas, scale: req.scale, ms: performance.now() - t0, errors: [{ layer: "*", message: (e as Error).message }] });
    } finally {
      this.running = false;
      if (this.pending && !this.disposed) this.request(this.pending);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
  }
}
