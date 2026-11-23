import clsx from "clsx";
import { Bot, ChevronDown, ChevronLeft, CircleAlert, Cloud, HardDrive, Keyboard, Loader2, Maximize, Minus, Plus, Redo2, ShieldCheck, Undo2, Upload } from "lucide-react";
import { useId } from "react";
import { Button, IconButton } from "../components/ui/controls";
import { Popover } from "../components/ui/Popover";
import { useI18n } from "../i18n";
import { useEditor, useSnapshot, useUi } from "../state/context";
import { zoomBy, zoomTo } from "../state/shortcuts";

const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
export const MOD = mac ? "⌘" : "Ctrl+";

export function TopBar() {
  const { t, lang, setLang } = useI18n();
  const api = useEditor();
  const { store, ui, backend, closeProject, runCheck } = api;
  const snap = useSnapshot();
  const assistant = useUi((s) => s.assistant);
  const check = useUi((s) => s.check);
  const checkRunning = useUi((s) => s.checkRunning);
  const pulse = useUi((s) => s.agentPulse);
  const errors = snap.issues.filter((i) => i.severity === "error").length;
  const checkCount = check ? (check.counts?.errors ?? 0) + (check.counts?.warnings ?? 0) : errors;

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-ink-1 px-2">
      <div className="flex min-w-0 items-center gap-1.5" style={{ width: 300 }}>
        <IconButton label={t("top.projects")} onClick={closeProject}>
          <ChevronLeft size={15} />
        </IconButton>
        <Logo key={pulse} className={pulse ? "agent-pulse rounded-[6px]" : undefined} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{snap.doc?.title || backend.projectTitle()}</div>
          <div className="flex items-center gap-1 truncate text-2xs text-fg-faint" title={backend.location ?? ""}>
            {backend.mode === "cli" ? <HardDrive size={10} /> : <Cloud size={10} />}
            <span className="truncate">{backend.mode === "cli" ? shortPath(backend.location) : t("top.inBrowser")}</span>
            {snap.doc && (
              <span className="shrink-0 tabular-nums">
                · {snap.doc.canvas.width}×{snap.doc.canvas.height}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-0.5">
        <IconButton label={t("top.undo")} shortcut={`${MOD}Z`} disabled={!snap.canUndo} onClick={() => store.undo()}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton label={t("top.redo")} shortcut={`${MOD}⇧Z`} disabled={!snap.canRedo} onClick={() => store.redo()}>
          <Redo2 size={15} />
        </IconButton>
        <SaveChip />
      </div>

      <div className="mx-auto flex items-center">
        <ZoomControl />
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" onClick={() => void runCheck()} title={t("top.checkHint")}>
          {checkRunning ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
          {t("top.check")}
          {checkCount > 0 && <span className={clsx("rounded px-1 text-2xs font-semibold", (check?.counts?.errors ?? errors) > 0 ? "bg-danger/20 text-danger" : "bg-warn/20 text-warn")}>{checkCount}</span>}
        </Button>
        <Button variant="primary" onClick={() => ui.set({ dialog: "export" })}>
          <Upload size={14} />
          {t("top.export")}
        </Button>
        <div className="mx-1 h-5 w-px bg-line" />
        <IconButton label={t("top.assistant")} active={assistant} onClick={() => ui.set({ assistant: !assistant })}>
          <Bot size={16} />
        </IconButton>
        <IconButton label={t("top.shortcuts")} shortcut="?" onClick={() => ui.set({ dialog: "shortcuts" })}>
          <Keyboard size={15} />
        </IconButton>
        <button type="button" onClick={() => setLang(lang === "en" ? "fr" : "en")} title={t("top.language")} className="h-7 rounded-md px-1.5 text-2xs font-semibold text-fg-muted hover:bg-ink-3 hover:text-fg">
          {lang.toUpperCase()}
        </button>
      </div>
    </header>
  );
}

function ZoomControl() {
  const { t } = useI18n();
  const api = useEditor();
  const zoom = useUi((s) => s.view.zoom);
  return (
    <div className="flex items-center rounded-md bg-ink-2/70 p-0.5">
      <IconButton label={t("zoom.out")} shortcut={`${MOD}-`} onClick={() => zoomBy(api, 0.8)} className="h-6 w-6">
        <Minus size={13} />
      </IconButton>
      <Popover
        width={180}
        align="start"
        trigger={(open, isOpen) => (
          <button type="button" onClick={open} aria-expanded={isOpen} aria-label={t("zoom.menu")} className="flex h-6 w-[66px] items-center justify-center gap-0.5 rounded text-xs tabular-nums text-fg hover:bg-ink-3">
            {Math.round(zoom * 100)}%
            <ChevronDown size={11} className="text-fg-faint" />
          </button>
        )}
      >
        {(close) => (
          <div className="py-1 text-sm">
            {[
              { label: t("zoom.fit"), keys: `${MOD}0`, run: () => api.ui.set((s) => ({ fitRequest: s.fitRequest + 1 })) },
              { label: "50%", run: () => zoomTo(api, 0.5) },
              { label: t("zoom.actual"), keys: `${MOD}1`, run: () => zoomTo(api, 1) },
              { label: "200%", run: () => zoomTo(api, 2) },
              { label: "400%", run: () => zoomTo(api, 4) },
            ].map((it) => (
              <button key={it.label} type="button" onClick={() => (it.run(), close())} className="flex w-full items-center justify-between px-3 py-1 text-left hover:bg-ink-3">
                {it.label}
                {it.keys && <span className="text-2xs text-fg-faint">{it.keys}</span>}
              </button>
            ))}
          </div>
        )}
      </Popover>
      <IconButton label={t("zoom.in")} shortcut={`${MOD}+`} onClick={() => zoomBy(api, 1.25)} className="h-6 w-6">
        <Plus size={13} />
      </IconButton>
      <div className="mx-0.5 h-4 w-px bg-line" />
      <IconButton label={t("zoom.fit")} shortcut={`${MOD}0`} onClick={() => api.ui.set((s) => ({ fitRequest: s.fitRequest + 1 }))} className="h-6 w-6">
        <Maximize size={12} />
      </IconButton>
    </div>
  );
}

function shortPath(p: string | null): string {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : p;
}

// The AgentPhoto mark (same drawing as index.html's favicon): dark tile, white photo frame, blue sun.
export function Logo({ size = 22, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={clsx("shrink-0", className)}>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2a30" />
          <stop offset="1" stopColor="#0c0c0f" />
        </linearGradient>
        <linearGradient id={`${id}dot`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7aa5ff" />
          <stop offset="1" stopColor="#3d6bff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill={`url(#${id}bg)`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7" fill="none" stroke="#ffffff" strokeOpacity="0.12" />
      <rect x="7" y="9" width="18" height="14" rx="2.5" fill="none" stroke="#fff" strokeWidth="2.2" />
      <path d="M9 21l5-5 3 3 2.5-2.5L23 20" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="20.5" cy="13.5" r="2" fill={`url(#${id}dot)`} />
    </svg>
  );
}

function SaveChip() {
  const { t } = useI18n();
  const snap = useSnapshot();
  const s = snap.save;
  const label = s.state === "saved" ? t("save.saved") : s.state === "saving" ? t("save.saving") : s.state === "pending" ? t("save.pending") : t("save.error");
  return (
    <div className={clsx("ml-1 flex h-6 items-center gap-1 rounded-md px-1.5 text-2xs", s.state === "error" ? "bg-danger/15 text-danger" : "text-fg-faint")} title={s.state === "error" ? `${s.message ?? ""}\n${t("save.errorHint")}` : label}>
      {s.state === "error" ? <CircleAlert size={11} /> : <span className={clsx("h-1.5 w-1.5 rounded-full", s.state === "saved" ? "bg-agent/70" : "animate-pulse bg-key")} />}
      {label}
    </div>
  );
}
