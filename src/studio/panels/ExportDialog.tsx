// Export: format, quality, size (original / preset / custom / scale) with
// fit, background for transparency, file name; live preview and exact size
// (encoded in the page with the engine). CLI projects write dist/… through
// the export tool; in-browser projects download the file.

import clsx from "clsx";
import { AlertTriangle, Download, FileImage, Loader2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SIZE_PRESETS } from "../../core/catalog";
import { createCanvas } from "../../engine";
import { DEFAULT_QUALITY, FORMAT_EXT, IMAGE_FORMATS, planExport, type ExportJob, type ExportRequest } from "../../ops/export";
import type { ImageFormat } from "../../core/types";
import { ColorField } from "../components/ui/ColorPicker";
import { Dialog } from "../components/ui/Dialog";
import { NumberField, SliderField } from "../components/ui/NumberField";
import { toast } from "../components/ui/Toast";
import { Button, Row, Select, TextField, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { saveBytes } from "../lib/download";
import { sizeTitle } from "../lib/labels";
import { formatBytes } from "../lib/num";
import { useDoc, useEditor } from "../state/context";

const MIME_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif" };

type SizeMode = "original" | "preset" | "custom" | "scale";

let avifSupport: Promise<boolean> | null = null;
export function canEncodeAvif(): Promise<boolean> {
  if (!avifSupport)
    avifSupport = (async () => {
      try {
        const c = createCanvas(2, 2) as OffscreenCanvas | HTMLCanvasElement;
        const blob = "convertToBlob" in c ? await (c as OffscreenCanvas).convertToBlob({ type: "image/avif" }) : await new Promise<Blob | null>((r) => (c as HTMLCanvasElement).toBlob(r, "image/avif"));
        return blob?.type === "image/avif";
      } catch {
        return false;
      }
    })();
  return avifSupport;
}

interface Encoded {
  url: string;
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
  ms: number;
}

export function ExportDialog() {
  const { t } = useI18n();
  const api = useEditor();
  const doc = useDoc();
  const ex = doc.export ?? {};
  const [format, setFormat] = useState<ImageFormat>(ex.format ?? "png");
  const [quality, setQuality] = useState<number>(ex.quality ?? DEFAULT_QUALITY[ex.format ?? "png"]);
  const [mode, setMode] = useState<SizeMode>("original");
  const [preset, setPreset] = useState("og");
  const [w, setW] = useState(doc.canvas.width);
  const [h, setH] = useState(doc.canvas.height);
  const [scale, setScale] = useState(1);
  const [fit, setFit] = useState<"cover" | "contain" | "stretch">("cover");
  const [flatten, setFlatten] = useState(!!ex.background);
  const [bg, setBg] = useState(ex.background ?? "#ffffff");
  const [name, setName] = useState(ex.name ?? doc.id ?? "photo");
  const [avif, setAvif] = useState(false);
  const [enc, setEnc] = useState<Encoded | null>(null);
  const [encoding, setEncoding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [written, setWritten] = useState<{ path: string; kb: number; width: number; height: number; url: string }[]>([]);

  useEffect(() => {
    void canEncodeAvif().then(setAvif);
  }, []);

  const req: ExportRequest = useMemo(
    () => ({
      format,
      quality,
      ...(mode === "preset" ? { preset, fit } : mode === "custom" ? { width: w, height: h, fit } : mode === "scale" ? { scale } : {}),
      background: flatten || format === "jpeg" ? bg : null,
      name,
    }),
    [format, quality, mode, preset, fit, w, h, scale, flatten, bg, name],
  );
  const plan = useMemo((): { job: ExportJob | null; error: string | null } => {
    try {
      return { job: planExport(doc, req), error: null };
    } catch (e) {
      return { job: null, error: (e as Error).message };
    }
  }, [doc, req]);

  // Debounced in-page encode: preview + exact size.
  useEffect(() => {
    const job = plan.job;
    if (!job) return;
    let alive = true;
    setEncoding(true);
    const id = setTimeout(async () => {
      const t0 = performance.now();
      try {
        const e = await api.engine.exportImage(doc, job);
        if (!alive) return;
        const url = URL.createObjectURL(new Blob([e.bytes as BlobPart], { type: e.mime }));
        setEnc((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return { url, bytes: e.bytes, mime: e.mime, width: e.width, height: e.height, ms: Math.round(performance.now() - t0) };
        });
      } catch {
        /* preview failed: the export itself reports errors */
      } finally {
        if (alive) setEncoding(false);
      }
    }, 350);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [plan.job, doc, api]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => void (enc && URL.revokeObjectURL(enc.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => api.ui.set({ dialog: null });
  const ext = FORMAT_EXT[format];
  const mimeMismatch = enc && plan.job && enc.mime !== plan.job.mime;

  const runExport = async (r: ExportRequest) => {
    setBusy(true);
    try {
      if (api.backend.mode === "cli") {
        const res = await api.runTool<{ files: { path: string; kb: number; width: number; height: number }[] }>("export", r as Record<string, unknown>);
        if (res?.files) {
          const files = await Promise.all(res.files.map(async (f) => ({ ...f, url: await api.backend.fileUrl(f.path) })));
          setWritten((prev) => [...files, ...prev].slice(0, 6));
          toast({ tone: "success", title: t("export.written", { n: files.length }), detail: files.map((f) => f.path).join(", ") });
        }
      } else {
        const job = planExport(doc, r);
        const e = enc && r === req ? enc : await api.engine.exportImage(doc, job);
        const fileExt = MIME_EXT[e.mime] ?? FORMAT_EXT[job.format];
        const file = `${job.file.split("/").pop()!.replace(/\.[^.]+$/, "")}.${fileExt}`;
        const how = await saveBytes(file, e.bytes, e.mime);
        if (how !== "cancelled") toast({ tone: "success", title: t("export.downloaded", { file }) });
      }
    } catch (e) {
      toast({ tone: "error", title: t("export.failed"), detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("export.title")}
      width={880}
      onClose={close}
      footer={
        <>
          <div className="mr-auto flex items-center gap-1.5 text-xs text-fg-muted">
            <span>{t("export.variants")}</span>
            {["og", "square", "story"].map((p) => (
              <Button key={p} size="xs" variant="ghost" disabled={busy} onClick={() => void runExport({ ...req, preset: p, fit: "cover", width: undefined, height: undefined, scale: undefined })} title={sizeTitle(p)}>
                {p}
              </Button>
            ))}
          </div>
          <Button variant="ghost" onClick={close}>
            {t("ui.close")}
          </Button>
          <Button variant="primary" disabled={!plan.job || busy} onClick={() => void runExport(req)}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : api.backend.mode === "cli" ? <Upload size={13} /> : <Download size={13} />}
            {api.backend.mode === "cli" ? t("export.write") : t("export.download")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-[420px] flex-col border-r border-line bg-ink-0/50 p-4">
          <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-ink-0">
            {enc ? <img src={enc.url} alt={t("export.previewAlt")} className="checker max-h-[440px] max-w-full object-contain shadow-lg shadow-black/50" /> : <Loader2 size={18} className="animate-spin text-fg-faint" />}
            {encoding && enc && (
              <div className="absolute right-2 top-2 rounded bg-black/60 p-1">
                <Loader2 size={12} className="animate-spin text-white/80" />
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3 text-xs text-fg-muted">
            <FileImage size={13} />
            {plan.job && (
              <span className="tabular-nums text-fg">
                {plan.job.width} × {plan.job.height} px
              </span>
            )}
            {enc && <span className="tabular-nums">{formatBytes(enc.bytes.byteLength)}</span>}
            {enc && <span className="text-fg-faint">{enc.mime}</span>}
            {enc && <span className="ml-auto text-fg-faint">{t("export.encodedIn", { ms: enc.ms })}</span>}
          </div>
          {mimeMismatch && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-warn">
              <AlertTriangle size={12} /> {t("export.fallback", { format: format.toUpperCase(), mime: enc!.mime })}
            </div>
          )}
          {plan.error && <div className="mt-2 text-xs text-danger">{plan.error}</div>}
        </div>

        <div className="space-y-0.5 py-3">
          <Row label={t("export.format")}>
            <div className="flex flex-1 rounded-md bg-ink-2 p-0.5">
              {IMAGE_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  disabled={f === "avif" && !avif}
                  title={f === "avif" && !avif ? t("export.noAvif") : undefined}
                  onClick={() => (setFormat(f), setQuality(DEFAULT_QUALITY[f]))}
                  className={clsx("h-6 flex-1 rounded text-xs font-medium uppercase disabled:opacity-30", format === f ? "bg-ink-4 text-fg" : "text-fg-muted hover:text-fg")}
                >
                  {f === "jpeg" ? "jpg" : f}
                </button>
              ))}
            </div>
          </Row>
          {format !== "png" && (
            <Row label={t("export.quality")}>
              <SliderField value={quality} min={1} max={100} integer onChange={(v) => setQuality(v)} ariaLabel={t("export.quality")} />
            </Row>
          )}
          <Row label={t("export.size")}>
            <Select value={mode} options={(["original", "preset", "custom", "scale"] as const).map((m) => ({ value: m, label: t(`export.sizes.${m}`) }))} onChange={(v) => setMode(v as SizeMode)} ariaLabel={t("export.size")} />
          </Row>
          {mode === "preset" && (
            <Row label={t("export.preset")}>
              <Select value={preset} options={SIZE_PRESETS.map((p) => ({ value: p.id, label: `${sizeTitle(p.id)} · ${p.width}×${p.height}` }))} onChange={setPreset} ariaLabel={t("export.preset")} />
            </Row>
          )}
          {mode === "custom" && (
            <Row label={t("props.size")}>
              <NumberField label="W" value={w} min={1} max={16384} integer onChange={(v) => setW(v)} />
              <NumberField label="H" value={h} min={1} max={16384} integer onChange={(v) => setH(v)} />
            </Row>
          )}
          {mode === "scale" && (
            <Row label={t("export.scale")}>
              <SliderField value={scale} min={0.05} max={4} step={0.05} onChange={(v) => setScale(v)} ariaLabel={t("export.scale")} />
            </Row>
          )}
          {(mode === "preset" || mode === "custom") && (
            <Row label={t("export.fit")}>
              <Select value={fit} options={(["cover", "contain", "stretch"] as const).map((f) => ({ value: f, label: t(`export.fits.${f}`) }))} onChange={(v) => setFit(v as typeof fit)} ariaLabel={t("export.fit")} />
            </Row>
          )}
          <Row label={t("export.background")}>
            <Toggle checked={flatten || format === "jpeg"} onChange={setFlatten} ariaLabel={t("export.flatten")} />
            {(flatten || format === "jpeg") && <ColorField value={bg} alpha={false} onChange={(v) => setBg(v)} />}
            {!flatten && format !== "jpeg" && <span className="text-2xs text-fg-faint">{t("export.transparent")}</span>}
          </Row>
          <Row label={t("export.name")}>
            <TextField value={name} onCommit={(v) => setName(v.trim() || doc.id)} ariaLabel={t("export.name")} />
            <span className="text-xs text-fg-faint">.{ext}</span>
          </Row>
          {api.backend.mode === "cli" && plan.job && <div className="px-3 pt-2 font-mono text-2xs text-fg-faint">→ {plan.job.file}</div>}

          {written.length > 0 && (
            <div className="mx-3 mt-3 space-y-1 rounded-lg border border-agent/30 bg-agent/5 p-2">
              <div className="text-2xs font-semibold uppercase tracking-wide text-agent">{t("export.writtenTitle")}</div>
              {written.map((f) => (
                <div key={f.path + f.url} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate font-mono text-2xs">{f.path}</span>
                  <span className="shrink-0 tabular-nums text-fg-faint">{f.kb} KB</span>
                  <a href={f.url} download={f.path.split("/").pop()} className="shrink-0 text-accent hover:underline">
                    {t("export.downloadOne")}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
