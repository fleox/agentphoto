// The editor layout + wiring: document store ↔ backend, live engine, external
// changes (SSE / in-browser file events), AI tool runs, keyboard shortcuts.

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { modelDef } from "../core/catalog";
import { imageInfo } from "../core/imageInfo";
import type { LibraryIndex } from "../core/library";
import type { PhotoDoc } from "../core/types";
import { Compositor, Engine, encode } from "../engine";
import { diffDocs } from "../ops/doc";
import { walkLayers } from "../ops/tree";
import { AssistantPanel } from "./assistant/AssistantPanel";
import type { Backend, ToolInfo } from "./backend/types";
import { Toaster, toast } from "./components/ui/Toast";
import { t } from "./i18n";
import { bytesToDataUrl } from "./lib/download";
import { imageLayer } from "./lib/layers";
import { useNarrow } from "./lib/touch";
import { urlParam } from "./lib/urlState";
import { AiConsentDialog, BusyOverlay, hasConsent } from "./panels/AiDialogs";
import { ExportDialog } from "./panels/ExportDialog";
import { OptionsBar } from "./panels/OptionsBar";
import { RightPanel } from "./panels/RightPanel";
import { ShortcutsDialog } from "./panels/ShortcutsDialog";
import { StatusBar } from "./panels/StatusBar";
import { ToolRail } from "./panels/ToolRail";
import { TopBar } from "./panels/TopBar";
import { Viewport } from "./panels/Viewport";
import { BoxTracker } from "./render/boxes";
import { EditorContext, useEditor, useUi, type EditorApi, type RightTab, type UiState } from "./state/context";
import { EditorStore, type MutationResult } from "./state/editorStore";
import { createStore } from "./state/tinyStore";
import { useShortcuts } from "./state/shortcuts";
import { TOOLS } from "./tools/registry";
import { ToolCallError } from "./backend/types";

function initialUi(): UiState {
  const panel = urlParam("panel");
  const dialog = urlParam("dialog");
  const tool = urlParam("tool");
  return {
    tool: (TOOLS.some((x) => x.id === tool) ? tool : "move") as UiState["tool"],
    shapeKind: "rect",
    marqueeKind: "rect",
    view: { zoom: 1, x: 0, y: 0 },
    fitRequest: 0,
    rightTab: (["properties", "filters", "looks", "effects"].includes(panel ?? "") ? panel : "properties") as RightTab,
    assistant: urlParam("assistant") === "1",
    panelsHidden: false,
    sheet: false,
    dialog: dialog === "export" || dialog === "shortcuts" ? dialog : null,
    flash: null,
    agentPulse: 0,
    region: null,
    crop: null,
    textEdit: null,
    fg: "#ffffff",
    cursor: null,
    renderMs: 0,
    busy: null,
    consent: null,
    check: null,
    checkRunning: false,
    showMask: null,
    smartGuides: true,
    cropRatio: null,
    cropRatioId: "free",
    filesVersion: 0,
    collapsed: [],
    lassoKind: "free",
    maskTarget: null,
    brush: { size: 60, hardness: 0.7, opacity: 1, flow: 1 },
    maskPaint: "hide",
    cloneSource: null,
    wand: { tolerance: 24, contiguous: true, sampleAll: false },
    quick: null,
  };
}

export function Editor({ backend, onClose }: { backend: Backend; onClose(): void }) {
  const [api, setApi] = useState<EditorApi | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const naturals = new Map<string, { width: number; height: number }>();
    const store = new EditorStore((req) => backend.call<MutationResult>(req.kind === "patch" ? "doc_patch" : "doc_apply", req.kind === "patch" ? { ops: req.ops } : { doc: req.doc }), { sizes: () => Object.fromEntries(naturals) });
    const ui = createStore<UiState>(initialUi());
    const engine = new Engine(backend.engineOptions());
    const thumbs = new Compositor(engine.loader);
    const boxes = new BoxTracker(thumbs);

    // Natural sizes of the image sources (geometry ops need them locally).
    const learnSizes = (doc: PhotoDoc) => {
      walkLayers(doc.layers, (l) => {
        if (l.type === "image" && !naturals.has(l.src))
          void thumbs
            .naturalSize(l.src)
            .then((s) => naturals.set(l.src, s))
            .catch(() => undefined);
      });
    };
    const offStore = store.subscribe(() => {
      const d = store.doc;
      if (d) {
        learnSizes(d);
        void boxes.update(d);
      }
    });

    const reloadDoc = async (opts: { toast?: boolean } = {}) => {
      const doc = await backend.loadDoc();
      if (store.isEcho(doc)) return;
      const before = store.doc;
      if (!store.external(doc)) return;
      const plan = diffDocs(before, doc);
      const ids = [...plan.layers.added, ...plan.layers.changed.map((c) => c.id), ...plan.layers.moved.map((m) => m.id)];
      ui.set((s) => ({ flash: { ids, at: Date.now() }, agentPulse: s.agentPulse + 1 }));
      if (opts.toast !== false) toast({ tone: "agent", title: t("external.title"), detail: plan.summary, action: { label: t("external.undo"), run: () => store.undo() } }, 6000);
    };

    const askConsent = (model: string) =>
      new Promise<boolean>((resolve) => {
        if (hasConsent(model)) return resolve(true);
        // Already in the CLI's cache: nothing to download, nothing to ask.
        void backend
          .modelCached(model)
          .catch(() => false)
          .then((cached) => {
            if (cached) return resolve(true);
            ui.set({ consent: { model, resolve: (ok) => (ui.set({ consent: null }), resolve(ok)) } });
          });
      });

    let toolList: ToolInfo[] = [];
    const editorApi = (library: LibraryIndex): EditorApi => ({
      backend,
      store,
      ui,
      tools: toolList,
      library,
      engine,
      thumbs,
      boxes,
      edit(ops, opts) {
        const err = store.edit(ops, opts);
        if (err) toast({ tone: "error", title: t("edit.failed"), detail: err });
        return !err;
      },
      async runCheck() {
        ui.set({ checkRunning: true });
        try {
          await store.flush();
          const r = await backend.call<Omit<UiState["check"] & object, "at">>("check", {});
          ui.set({ check: { ...r, at: Date.now() } });
          const c = r.counts ?? { errors: 0, warnings: 0, infos: 0 };
          toast({ tone: c.errors ? "error" : "success", title: c.errors || c.warnings ? t("check.found", { errors: c.errors, warnings: c.warnings }) : t("check.ok"), detail: r.issues?.find((i) => i.severity !== "info")?.message }, 5000);
        } catch (e) {
          toast({ tone: "error", title: t("check.failed"), detail: (e as Error).message });
        } finally {
          ui.set({ checkRunning: false });
        }
      },
      reloadDoc,
      async runTool<T>(name: string, input: Record<string, unknown>, opts: { busy?: Parameters<typeof t>[0]; model?: string; flash?: boolean } = {}) {
        if (opts.model && modelDef(opts.model) && !(await askConsent(opts.model))) return null;
        await store.flush();
        if (opts.busy) ui.set({ busy: { label: t(opts.busy) } });
        try {
          const r = await backend.call<T>(name, input);
          if (toolList.find((x) => x.name === name)?.mutating) await reloadDoc({ toast: false });
          return r;
        } catch (e) {
          const err = e as ToolCallError;
          toast({ tone: "error", title: t("tools.failed", { tool: name }), detail: [err.message, err.hint].filter(Boolean).join(" — ") }, 8000);
          return null;
        } finally {
          if (opts.busy) ui.set({ busy: null });
        }
      },
      async importImages(files, at) {
        for (const f of files) {
          const info = imageInfo(f.bytes);
          if (!info) {
            toast({ tone: "error", title: t("import.notImage", { name: f.name }) });
            continue;
          }
          try {
            const path = await backend.addImage(f.name, f.bytes);
            const doc = store.doc!;
            const layer = imageLayer(doc, path, info, f.name, at);
            const above = store.primary;
            store.edit([{ op: "addLayer", layer, ...(above ? { above } : {}) }], { select: layer.id });
            toast({ tone: "success", title: t("import.done", { name: f.name }) }, 2400);
          } catch (e) {
            toast({ tone: "error", title: t("import.failed", { name: f.name }), detail: (e as Error).message });
          }
        }
      },
      closeProject() {
        void (async () => {
          await store.flush();
          const doc = store.doc;
          if (doc && backend.saveThumb) {
            try {
              const k = Math.min(1, 320 / Math.max(doc.canvas.width, doc.canvas.height));
              const c = await engine.render(doc, { scale: k });
              const e = await encode(c, "image/jpeg", 80);
              await backend.saveThumb(bytesToDataUrl(e.bytes, "image/jpeg"));
            } catch {
              /* no thumbnail */
            }
          }
          onClose();
        })();
      },
      naturalSize: (src) => naturals.get(src),
      ensureModel: (model) => askConsent(model),
    });

    void (async () => {
      try {
        const [doc, tools, library] = await Promise.all([backend.loadDoc(), backend.tools().catch(() => [] as ToolInfo[]), backend.library().catch(() => ({ assets: [] }) as LibraryIndex)]);
        if (cancelled) return;
        toolList = tools;
        engine.setLibrary(library);
        store.load(doc);
        const sel = urlParam("select");
        if (sel) store.select(sel.split(","));
        setApi(editorApi(library));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    // Someone else changed the project (an agent in a terminal, a tool): reload and show it.
    const off =
      urlParam("events") === "0"
        ? () => undefined
        : backend.onChange((paths) => {
            const files = paths.filter((p) => p.startsWith("assets/"));
            for (const p of files) engine.loader.invalidate(p);
            if (files.length) ui.set((s) => ({ filesVersion: s.filesVersion + 1 }));
            if (paths.includes("photo.json")) void reloadDoc().catch(() => undefined);
          });
    const offProgress = backend.onAiProgress((p) => {
      if (ui.get().busy) ui.set({ busy: { label: p.progress < 1 ? t("ai.downloading", { model: p.model, pct: Math.round(p.progress * 100) }) : t("ai.running"), progress: p.progress < 1 ? p.progress : undefined } });
    });
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (store.dirty) {
        void store.flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      cancelled = true;
      off();
      offProgress();
      offStore();
      window.removeEventListener("beforeunload", beforeUnload);
      void store.flush();
    };
  }, [backend, onClose]);

  if (error)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <div className="text-base font-medium">{t("app.loadFailed")}</div>
        <div className="max-w-md text-sm text-fg-muted">{error}</div>
        <button type="button" onClick={onClose} className="mt-2 text-sm text-accent hover:underline">
          {t("app.back")}
        </button>
      </div>
    );
  if (!api)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-fg-muted">
        <Loader2 size={16} className="animate-spin" /> {t("app.loadingDoc")}
      </div>
    );
  return (
    <EditorContext.Provider value={api}>
      <Shell />
    </EditorContext.Provider>
  );
}

function Shell() {
  const assistant = useUi((s) => s.assistant);
  const dialog = useUi((s) => s.dialog);
  const hidden = useUi((s) => s.panelsHidden);
  const sheet = useUi((s) => s.sheet);
  const narrow = useNarrow();
  const { ui } = useEditor();
  useShortcuts();
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {!hidden && <ToolRail />}
        <div className="relative flex min-w-0 flex-1 flex-col">
          {!hidden && <OptionsBar />}
          <Viewport />
          <StatusBar />
          <Toaster />
          <BusyOverlay />
        </div>
        {!hidden && !narrow && <RightPanel />}
        {assistant && !narrow && <AssistantPanel />}
      </div>
      {/* Narrow screens: the inspector (or the assistant) is a drawer over the canvas. */}
      {narrow && (sheet || assistant) && (
        <div className="fixed inset-x-0 bottom-0 top-11 z-40 flex justify-end bg-black/45" onPointerDown={(e) => e.target === e.currentTarget && ui.set({ sheet: false, assistant: false })}>
          {assistant ? <AssistantPanel /> : <RightPanel />}
        </div>
      )}
      {dialog === "export" && <ExportDialog />}
      {dialog === "shortcuts" && <ShortcutsDialog />}
      <AiConsentDialog />
    </div>
  );
}
