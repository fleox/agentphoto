// Filter stack of the selected layer (or of an adjustment layer): add from the
// catalog (grouped), cards with generated controls, enable eye, amount,
// drag to reorder, delete. Live preview while dragging (the store updates the
// document immediately, persistence is debounced). One-click auto enhance.

import clsx from "clsx";
import { ChevronDown, ChevronRight, Eye, EyeOff, GripVertical, Plus, Search, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { FILTERS, filterDef, type FilterDef } from "../../core/catalog";
import type { Filter, Layer } from "../../core/types";
import type { ImageStats } from "../../engine";
import type { PatchOp } from "../../ops/doc";
import { Button, Empty, IconButton } from "../components/ui/controls";
import { SliderField } from "../components/ui/NumberField";
import { Popover } from "../components/ui/Popover";
import { toast } from "../components/ui/Toast";
import { useI18n } from "../i18n";
import { filterGroupTitle, filterTitle, lookTitle } from "../lib/labels";
import { newId } from "../lib/layers";
import { useEditor, useSelectedLayer } from "../state/context";
import { CurvesField, ParamField } from "./ParamField";

const GROUP_ORDER: FilterDef["group"][] = ["auto", "light", "tone", "color", "detail", "blur", "stylize", "look"];

// A new filter with its defaults filled in (so the controls show real values).
export function newFilter(def: FilterDef): Filter {
  const f: Filter = { type: def.id };
  for (const p of def.params) if (p.default !== undefined && p.type !== "curve") f[p.name] = p.default;
  if (def.id === "curves") f.rgb = [[0, 0], [255, 255]];
  return f;
}

export async function autoEnhance(api: ReturnType<typeof useEditor>, layer: Layer | null, t: ReturnType<typeof useI18n>["t"]): Promise<void> {
  const target = layer && (layer.type === "image" || layer.type === "adjustment") ? layer : null;
  const stats = await api.runTool<ImageStats>("image_analyze", target?.type === "image" ? { layer: target.id } : {}, { busy: "filters.analyzing" });
  if (!stats) return;
  const filters = (stats.suggestions ?? []).map((s) => ({ ...(s.filter as Filter) }));
  if (!filters.length) return void toast({ tone: "success", title: t("filters.autoNone") });
  const doc = api.store.doc!;
  let ops: PatchOp[];
  let select: string;
  if (target) {
    ops = [{ op: "updateLayer", id: target.id, set: { filters: [...(target.filters ?? []), ...filters] } }];
    select = target.id;
  } else {
    const id = newId(doc, "auto-enhance");
    ops = [{ op: "addLayer", layer: { id, type: "adjustment", name: t("filters.autoName"), filters } }];
    select = id;
  }
  if (api.edit(ops, { select })) toast({ tone: "success", title: t("filters.autoDone", { n: filters.length }), detail: stats.suggestions.map((s) => s.issue).join(" · "), action: { label: t("external.undo"), run: () => api.store.undo() } }, 7000);
}

export function FiltersPanel() {
  const { t } = useI18n();
  const api = useEditor();
  const layer = useSelectedLayer();
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [auto, setAuto] = useState(false);
  if (!layer)
    return (
      <div>
        <Empty icon={<SlidersHorizontal size={22} />} title={t("filters.noLayer")}>
          {t("filters.noLayerHint")}
        </Empty>
        <div className="flex justify-center">
          <Button size="sm" variant="subtle" disabled={auto} onClick={async () => (setAuto(true), await autoEnhance(api, null, t), setAuto(false))}>
            <Sparkles size={13} className="text-agent" /> {t("filters.autoWhole")}
          </Button>
        </div>
      </div>
    );
  const filters = layer.filters ?? [];
  const id = layer.id;
  const add = (type: string) => {
    const def = filterDef(type);
    if (!def) return;
    api.edit([{ op: "addFilter", id, filter: newFilter(def) }]);
    setOpen((o) => ({ ...o, [filters.length]: true }));
  };
  const upd = (index: number, set: Record<string, unknown>, final: boolean) => api.edit([{ op: "updateFilter", id, index, set }], final ? {} : { coalesce: `filter:${id}:${index}:${Object.keys(set).join(",")}` });
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const next = [...filters];
    const [f] = next.splice(from, 1);
    next.splice(to, 0, f);
    api.edit([{ op: "updateLayer", id, set: { filters: next } }]);
  };

  return (
    <div className="pb-4">
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{layer.type === "adjustment" ? t("filters.adjustTitle") : t("filters.title")}</div>
          <div className="truncate text-2xs text-fg-faint">{layer.type === "adjustment" ? t("filters.adjustHint") : t("filters.hint")}</div>
        </div>
        <AddFilterMenu onPick={add} />
      </div>
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <Button size="xs" variant="subtle" disabled={auto} onClick={async () => (setAuto(true), await autoEnhance(api, layer, t), setAuto(false))} className="flex-1">
          <Sparkles size={12} className="text-agent" /> {t("filters.auto")}
        </Button>
      </div>
      {!filters.length && (
        <Empty icon={<SlidersHorizontal size={20} />} title={t("filters.empty")}>
          {t("filters.emptyHint")}
        </Empty>
      )}
      <div className="space-y-1.5 p-2">
        {filters.map((f, i) => {
          const def = filterDef(f.type);
          const isOpen = open[i] ?? i === filters.length - 1;
          const enabled = f.enabled !== false;
          // Filters with their own "amount" parameter (vignette, sharpen, noise…) have no blend slider.
          const ownAmount = !!def?.params.some((p) => p.name === "amount");
          return (
            <div
              key={i}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                if (drag.over !== i) setDrag({ ...drag, over: i });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag) reorder(drag.from, drag.over);
                setDrag(null);
              }}
              className={clsx("overflow-hidden rounded-lg border bg-ink-2/40", drag?.over === i && drag.from !== i ? "border-accent" : "border-line", !enabled && "opacity-60")}
            >
              <div className="flex h-8 items-center gap-1 pl-1 pr-1">
                <span draggable onDragStart={(e) => (setDrag({ from: i, over: i }), e.dataTransfer.setData("text/plain", String(i)))} onDragEnd={() => setDrag(null)} className="flex h-6 w-4 cursor-grab items-center justify-center text-fg-faint hover:text-fg" aria-label={t("filters.reorder")}>
                  <GripVertical size={12} />
                </span>
                <IconButton label={enabled ? t("filters.disable") : t("filters.enable")} onClick={() => upd(i, { enabled: enabled ? false : null }, true)} className="h-6 w-6">
                  {enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                </IconButton>
                <button type="button" onClick={() => setOpen((o) => ({ ...o, [i]: !isOpen }))} className="flex min-w-0 flex-1 items-center gap-1 text-left">
                  {isOpen ? <ChevronDown size={12} className="shrink-0 text-fg-faint" /> : <ChevronRight size={12} className="shrink-0 text-fg-faint" />}
                  <span className="truncate text-sm font-medium">{filterTitle(f.type)}</span>
                  {f.type === "look" && typeof f.look === "string" && <span className="truncate text-xs text-fg-muted">· {lookTitle(f.look)}</span>}
                  {!def && <span className="text-2xs text-danger">?</span>}
                </button>
                {!ownAmount && <span className="text-2xs tabular-nums text-fg-faint">{Math.round((typeof f.amount === "number" ? f.amount : 1) * 100)}%</span>}
                <IconButton label={t("filters.remove")} onClick={() => api.edit([{ op: "removeFilter", id, index: i }])} className="h-6 w-6 hover:text-danger">
                  <Trash2 size={12} />
                </IconButton>
              </div>
              {isOpen && def && (
                <div className="border-t border-line/70 pb-1.5 pt-1">
                  {def.id === "curves" ? <CurvesField filter={f} onChange={(name, v, final) => upd(i, { [name]: v === undefined ? null : v }, final)} /> : def.params.map((p) => <ParamField key={p.name} def={p} scope={def.id} value={f[p.name]} onChange={(v, final) => upd(i, { [p.name]: v === undefined ? null : v }, final)} />)}
                  {!ownAmount && <div className="mt-1 flex items-center gap-2 border-t border-line/50 px-3 pt-1.5">
                    <span className="w-[86px] shrink-0 text-xs text-fg-muted">{t("filters.amount")}</span>
                    <SliderField value={Math.round((typeof f.amount === "number" ? f.amount : 1) * 100)} min={0} max={100} integer onChange={(v, final) => upd(i, { amount: v >= 100 ? null : v / 100 }, final)} ariaLabel={t("filters.amount")} />
                  </div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddFilterMenu({ onPick }: { onPick(id: string): void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    return GROUP_ORDER.map((g) => ({ g, list: FILTERS.filter((f) => f.group === g && (!s || filterTitle(f.id).toLowerCase().includes(s) || f.id.toLowerCase().includes(s) || f.description.toLowerCase().includes(s))) })).filter((x) => x.list.length);
  }, [q]);
  return (
    <Popover
      width={268}
      trigger={(open, isOpen) => (
        <Button size="xs" variant={isOpen ? "subtle" : "primary"} onClick={() => (open(), setTimeout(() => input.current?.focus(), 30))}>
          <Plus size={12} /> {t("filters.add")}
        </Button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-1.5 border-b border-line px-2.5">
            <Search size={12} className="text-fg-faint" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("filters.search")} className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-fg-faint" />
          </div>
          <div className="max-h-[420px] overflow-auto py-1">
            {groups.map(({ g, list }) => (
              <div key={g}>
                <div className="px-3 pb-0.5 pt-2 text-2xs font-semibold uppercase tracking-wide text-fg-faint">{filterGroupTitle(g)}</div>
                {list.map((f) => (
                  <button key={f.id} type="button" onClick={() => (onPick(f.id), close(), setQ(""))} className="block w-full px-3 py-1 text-left hover:bg-ink-3" title={f.description}>
                    <div className="text-sm">{filterTitle(f.id)}</div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </Popover>
  );
}
