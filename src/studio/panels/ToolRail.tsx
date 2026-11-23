// Vertical tool rail: tools from the registry (tooltips with shortcuts),
// shape flyout, AI actions, foreground colour.

import clsx from "clsx";
import { Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ColorPicker } from "../components/ui/ColorPicker";
import { Popover } from "../components/ui/Popover";
import { useI18n } from "../i18n";
import { useEditor, useSnapshot, useUi } from "../state/context";
import { setTool } from "../state/shortcuts";
import { SHAPE_ICONS, ShapeKindPicker } from "../tools/draw";
import { AI_ACTIONS, TOOLS } from "../tools/registry";

function Tip({ label, keys, children, side = "right" }: { label: string; keys?: string; children: ReactNode; side?: "right" }) {
  return (
    <div className="group/tip relative">
      {children}
      <div className={clsx("pointer-events-none absolute top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-ink-1 px-2 py-1 text-xs text-fg shadow-lg shadow-black/40 group-hover/tip:flex", side === "right" && "left-full ml-2")}>
        {label}
        {keys && <kbd className="ml-2 rounded border border-line bg-ink-2 px-1 font-sans text-2xs text-fg-muted">{keys}</kbd>}
      </div>
    </div>
  );
}

export function ToolRail() {
  const { t } = useI18n();
  const api = useEditor();
  const tool = useUi((s) => s.tool);
  const shapeKind = useUi((s) => s.shapeKind);
  const fg = useUi((s) => s.fg);
  useSnapshot(); // AI actions depend on the selection
  const [flyout, setFlyout] = useState(false);
  const groups = ["select", "draw", "paint", "view"] as const;
  return (
    <nav aria-label={t("tools.title")} className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-line bg-ink-1 py-2">
      {groups.map((g, gi) => (
        <div key={g} className={clsx("flex flex-col items-center gap-0.5", gi > 0 && "mt-1.5 border-t border-line pt-1.5")}>
          {TOOLS.filter((x) => x.group === g).map((def) => {
            const Icon = def.id === "shape" ? SHAPE_ICONS[shapeKind] : def.icon;
            const active = tool === def.id;
            return (
              <Tip key={def.id} label={t(def.label)} keys={def.shortcut}>
                <button
                  type="button"
                  aria-label={t(def.label)}
                  aria-pressed={active}
                  data-tool={def.id}
                  onClick={() => (def.id === "shape" && active ? setFlyout((f) => !f) : setTool(api, def.id))}
                  onContextMenu={(e) => {
                    if (def.id !== "shape") return;
                    e.preventDefault();
                    setTool(api, "shape");
                    setFlyout(true);
                  }}
                  className={clsx("relative flex h-8 w-8 items-center justify-center rounded-md transition-colors", active ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-ink-3 hover:text-fg")}
                >
                  <Icon size={16} strokeWidth={1.75} />
                  {def.id === "shape" && <span className="absolute bottom-[3px] right-[3px] h-0 w-0 border-l-[4px] border-t-[4px] border-l-transparent border-t-current opacity-60" style={{ transform: "rotate(-90deg)" }} />}
                </button>
                {def.id === "shape" && flyout && (
                  <div className="absolute left-full top-0 z-50 ml-2 rounded-lg border border-line bg-ink-1 p-1 shadow-xl shadow-black/50" onMouseLeave={() => setFlyout(false)}>
                    <ShapeKindPicker
                      value={shapeKind}
                      onChange={(k) => {
                        api.ui.set({ shapeKind: k });
                        setTool(api, "shape");
                        setFlyout(false);
                      }}
                    />
                  </div>
                )}
              </Tip>
            );
          })}
        </div>
      ))}

      <div className="mt-1.5 flex flex-col items-center gap-0.5 border-t border-line pt-1.5">
        <Sparkles size={11} className="mb-0.5 text-agent/80" aria-hidden />
        {AI_ACTIONS.map((a) => {
          const enabled = a.enabled(api);
          return (
            <Tip key={a.id} label={`${t(a.label)} — ${t(a.hint)}`}>
              <button type="button" aria-label={t(a.label)} disabled={!enabled} onClick={() => void a.run(api)} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-agent/10 hover:text-agent disabled:opacity-30 disabled:hover:bg-transparent">
                <a.icon size={16} strokeWidth={1.75} />
              </button>
            </Tip>
          );
        })}
      </div>

      <div className="mt-auto">
        <Popover
          width={232}
          align="start"
          trigger={(open, isOpen) => (
            <Tip label={t("tools.foreground")}>
              <button type="button" aria-label={t("tools.foreground")} aria-expanded={isOpen} onClick={open} className="checker-sm relative h-6 w-6 overflow-hidden rounded-md ring-1 ring-white/20 hover:ring-white/50">
                <span className="absolute inset-0" style={{ background: fg }} />
              </button>
            </Tip>
          )}
        >
          {() => <ColorPicker value={fg} onChange={(v) => api.ui.set({ fg: v })} />}
        </Popover>
      </div>
    </nav>
  );
}
