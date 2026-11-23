// Start screen: open a photo (picker / drop), sample photos from the library,
// blank canvases from the size presets, templates (CLI), recent projects.

import clsx from "clsx";
import { ArrowRight, Cloud, FolderOpen, HardDrive, ImagePlus, Loader2, Terminal, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SIZE_PRESETS } from "../../core/catalog";
import type { LibraryAsset } from "../../core/library";
import type { TemplateInfo } from "../../ops/templates";
import type { Backend, CreateOptions, ProjectRef } from "../backend/types";
import { useI18n } from "../i18n";
import { sizeTitle } from "../lib/labels";
import { Logo } from "./TopBar";
import { readFiles } from "./Viewport";

function Aspect({ w, h, max = 46 }: { w: number; h: number; max?: number }) {
  const k = max / Math.max(w, h);
  return <div className="rounded-[3px] border border-fg-faint/60 bg-gradient-to-br from-ink-4/80 to-ink-3/40 transition-colors group-hover:border-accent/80 group-hover:from-accent/25" style={{ width: Math.max(8, w * k), height: Math.max(8, h * k) }} />;
}

export function StartScreen({ backend, onOpened }: { backend: Backend; onOpened(): void }) {
  const { t, lang, setLang } = useI18n();
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [samples, setSamples] = useState<LibraryAsset[]>([]);
  const [recent, setRecent] = useState<ProjectRef[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void backend.templates().then(setTemplates);
    void backend.library().then((l) => setSamples(l.assets.filter((a) => a.kind === "image")));
    void backend.recent().then(setRecent);
  }, [backend]);

  const canCreate = backend.canCreate();
  const create = async (key: string, opts: CreateOptions) => {
    // A CLI server edits one folder: a new project replaces the current one there.
    if (backend.mode === "cli" && backend.hasProject() && !window.confirm(t("start.replaceConfirm", { dir: backend.location ?? "" }))) return;
    setBusy(key);
    setError(null);
    try {
      await backend.createProject(opts);
      onOpened();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const openFiles = async (files: File[]) => {
    const f = files.find((x) => x.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif|bmp|svg)$/i.test(x.name));
    if (!f) return setError(t("start.notImage"));
    const [file] = await readFiles([f]);
    await create("photo", { title: f.name.replace(/\.[^.]+$/, "") || "Photo", image: file });
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1240px] px-8 py-8">
        <header className="mb-8 flex items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Logo size={36} />
            <div>
              <h1 className="text-[22px] font-semibold leading-tight tracking-tight">AgentPhoto Studio</h1>
              <p className="mt-0.5 max-w-xl text-sm text-fg-muted">{t("start.tagline")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {backend.hasProject() && (
              <button type="button" onClick={onOpened} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-ink-0 hover:bg-accent/90">
                {t("start.continue", { title: backend.projectTitle() })} <ArrowRight size={14} />
              </button>
            )}
            <div className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-muted">
              {backend.mode === "cli" ? <HardDrive size={12} /> : <Cloud size={12} />}
              {backend.mode === "cli" ? t("start.cliMode", { v: backend.version ?? "" }) : t("start.localMode")}
            </div>
            <button type="button" onClick={() => setLang(lang === "en" ? "fr" : "en")} title={t("top.language")} className="h-8 rounded-md px-2 text-xs font-semibold text-fg-muted hover:bg-ink-3 hover:text-fg">
              {lang.toUpperCase()}
            </button>
          </div>
        </header>

        {!canCreate && (
          <div className="mb-6 flex gap-3 rounded-lg border border-line bg-ink-1 p-4">
            <Terminal size={16} className="mt-0.5 shrink-0 text-accent" />
            <div className="text-sm">
              <div className="font-medium">{t("start.noFolderTitle")}</div>
              <div className="mt-1 text-xs text-fg-muted">{t("start.noFolderBody")}</div>
              <pre className="mt-2 rounded bg-ink-0 px-2 py-1.5 font-mono text-2xs text-fg">agentphoto new my-photo --image photo.jpg{"\n"}agentphoto studio --project my-photo</pre>
            </div>
          </div>
        )}
        {error && <div className="mb-6 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}

        <div className="grid grid-cols-[minmax(0,1fr)_272px] gap-10">
          <div className="min-w-0 space-y-9">
            {/* Hero: open a photo */}
            <section
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void openFiles([...e.dataTransfer.files]);
              }}
              className={clsx(
                "relative flex items-center gap-6 overflow-hidden rounded-xl border border-dashed px-8 py-8 transition-colors",
                drag ? "border-accent bg-accent/10" : "border-line bg-ink-1",
              )}
              style={drag ? undefined : { backgroundImage: "radial-gradient(120% 140% at 0% 0%, rgb(var(--accent) / 0.16), transparent 55%), radial-gradient(90% 120% at 100% 100%, rgb(var(--agent) / 0.08), transparent 60%)" }}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent ring-1 ring-accent/30">
                {busy === "photo" ? <Loader2 size={26} className="animate-spin" /> : <ImagePlus size={28} strokeWidth={1.6} />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold tracking-tight">{t("start.openTitle")}</h2>
                <p className="mt-1 max-w-lg text-sm text-fg-muted">{t("start.openBody")}</p>
              </div>
              <button type="button" disabled={!canCreate || !!busy} onClick={() => input.current?.click()} className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-ink-0 shadow-lg shadow-accent/20 hover:bg-accent/90 disabled:opacity-50">
                <Upload size={15} /> {t("start.choose")}
              </button>
              <input
                ref={input}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  if (files.length) void openFiles(files);
                }}
              />
            </section>

            {samples.length > 0 && (
              <section>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-base font-semibold">{t("start.samples")}</h2>
                  <span className="text-xs text-fg-faint">{t("start.samplesHint")}</span>
                </div>
                <div className="grid grid-cols-3 gap-3 xl:grid-cols-6">
                  {samples.map((s) => (
                    <button key={s.id} type="button" disabled={!canCreate || !!busy} onClick={() => void create(`sample:${s.id}`, { title: s.title ?? s.id, libraryImage: s.id })} className="group text-left disabled:opacity-60" title={s.description}>
                      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-ink-2 ring-1 ring-white/5 transition group-hover:ring-accent/60">
                        <img src={`${backend.libraryBase()}${s.path}`} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                        {busy === `sample:${s.id}` && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <Loader2 size={18} className="animate-spin" />
                          </div>
                        )}
                      </div>
                      <div className="mt-1.5 truncate text-xs font-medium capitalize">{s.id}</div>
                      <div className="truncate text-2xs text-fg-faint">
                        {s.width}×{s.height} · {s.license}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-base font-semibold">{t("start.blank")}</h2>
                <span className="text-xs text-fg-faint">{t("start.blankHint")}</span>
              </div>
              <div className="grid grid-cols-4 gap-2 xl:grid-cols-5">
                {SIZE_PRESETS.map((p) => (
                  <button key={p.id} type="button" disabled={!canCreate || !!busy} onClick={() => void create(`blank:${p.id}`, { title: sizeTitle(p.id), width: p.width, height: p.height, background: "#ffffff" })} className="group flex items-center gap-3 rounded-lg border border-line bg-ink-1 p-2.5 text-left transition-colors hover:border-accent/50 hover:bg-ink-2 disabled:opacity-60" title={p.description}>
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center">{busy === `blank:${p.id}` ? <Loader2 size={16} className="animate-spin" /> : <Aspect w={p.width} h={p.height} />}</div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{sizeTitle(p.id)}</div>
                      <div className="text-2xs tabular-nums text-fg-faint">
                        {p.width} × {p.height}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            {templates.length > 0 && (
              <section>
                <h2 className="mb-3 text-base font-semibold">{t("start.templates")}</h2>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
                  {templates.map((tp) => (
                    <button key={tp.id} type="button" disabled={!canCreate || !!busy} onClick={() => void create(tp.id, { title: tp.title, template: tp.id })} className="group rounded-lg p-2 text-left transition-colors hover:bg-ink-2 disabled:opacity-60">
                      <div className="relative aspect-[16/10] overflow-hidden rounded-md bg-ink-2">
                        <TemplatePreview src={backend.templatePreview(tp.id)} />
                        {busy === tp.id && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <Loader2 size={18} className="animate-spin" />
                          </div>
                        )}
                        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-2xs font-medium text-white/90 backdrop-blur">
                          {tp.width}×{tp.height}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-medium">{tp.title}</div>
                      <div className="line-clamp-2 text-xs text-fg-muted">{tp.description}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside>
            <h2 className="mb-3 text-base font-semibold">{t("start.recent")}</h2>
            {recent.length ? (
              <ul className="space-y-1">
                {recent.map((r) => (
                  <li key={r.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={async () => {
                        if (backend.mode === "cli") {
                          if (r.id === backend.location && backend.hasProject()) onOpened();
                          return;
                        }
                        try {
                          await backend.open(r.id);
                          onOpened();
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                      className={clsx("flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-ink-2", backend.mode === "cli" && r.id !== backend.location && "cursor-default opacity-60")}
                      title={backend.mode === "cli" && r.id !== backend.location ? t("start.otherFolder", { dir: r.id }) : r.id}
                    >
                      <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-ink-2 ring-1 ring-white/5">{r.thumb ? <img src={r.thumb} alt="" className="h-full w-full object-cover" /> : <FolderOpen size={14} className="text-fg-faint" />}</div>
                      <div className="min-w-0">
                        <div className="truncate text-sm">{r.title}</div>
                        <div className="truncate text-2xs text-fg-faint">{backend.mode === "cli" ? r.id : r.updatedAt ? new Date(r.updatedAt).toLocaleString() : ""}</div>
                      </div>
                    </button>
                    {backend.remove && (
                      <button type="button" aria-label={t("start.remove")} title={t("start.remove")} onClick={async () => (await backend.remove!(r.id), setRecent(await backend.recent()))} className="rounded p-1 text-fg-faint opacity-0 hover:text-danger group-hover:opacity-100">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-fg-faint">{t("start.noRecent")}</p>
            )}
            <div className="mt-8 rounded-lg border border-line bg-ink-1 p-3.5 text-xs leading-relaxed text-fg-muted">
              <div className="mb-1 font-medium text-fg">{t("start.agentTitle")}</div>
              {t("start.agentBody")}
              <pre className="mt-2 overflow-x-auto rounded bg-ink-0 px-2 py-1.5 font-mono text-2xs text-fg">agentphoto mcp</pre>
            </div>
            <div className="mt-3 rounded-lg border border-line p-3.5 text-xs leading-relaxed text-fg-muted">
              <div className="mb-1 font-medium text-fg">{t("start.privacyTitle")}</div>
              {t("start.privacyBody")}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function TemplatePreview({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(!src);
  return failed || !src ? <div className="h-full w-full bg-gradient-to-br from-ink-3 to-ink-1" /> : <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />;
}
