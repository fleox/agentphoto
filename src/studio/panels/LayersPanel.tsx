// Layers panel: the stack top → bottom with thumbnails, visibility, lock,
// inline rename, mask chips, drag & drop reordering (into groups too),
// multi-select, context menu; opacity + blend of the selection on top.

import clsx from "clsx";
import { ArrowDownToLine, ChevronDown, ChevronRight, Copy, Eye, EyeOff, Folder, FolderOpen, FolderPlus, Image as ImageIcon, Layers, Lock, LockOpen, Paintbrush, Plus, Shapes, SlidersHorizontal, Square, SquareDashed, Trash2, Type, Ungroup } from "lucide-react";
import { useRef, useState } from "react";
import { BLEND_MODES, type Layer, type Mask } from "../../core/types";
import { findLayer } from "../../ops/tree";
import { ContextMenu, type MenuEntry } from "../components/ui/ContextMenu";
import { IconButton, Select } from "../components/ui/controls";
import { SliderField } from "../components/ui/NumberField";
import { useI18n } from "../i18n";
import { blendTitle } from "../lib/labels";
import { tapTracker } from "../lib/touch";
import { defaultName, insertPosition, layerLabel, layerRows, moveOps, newId, shapeLayer, type DropWhere } from "../lib/layers";
import { LayerThumb, MaskThumb } from "../render/thumbs";
import { useEditor, useSnapshot, useUi } from "../state/context";
import { deleteSelection, duplicateSelection, groupSelection, setTool, ungroupSelection } from "../state/shortcuts";
import { MOD } from "./TopBar";
import { rasterizeLayer } from "../actions/layer";
import { readFiles } from "./Viewport";

export function toggleEnabled(m: Mask): Mask {
  const { enabled, ...rest } = m;
  return (enabled === false ? rest : { ...rest, enabled: false }) as Mask;
}

const TYPE_ICON: Record<Layer["type"], typeof Type> = { image: ImageIcon, text: Type, shape: Shapes, fill: Paintbrush, adjustment: SlidersHorizontal, group: Folder };

export function LayersPanel() {
  const { t } = useI18n();
  const api = useEditor();
  const { store, ui } = api;
  const snap = useSnapshot();
  const doc = snap.doc!;
  const collapsed = useUi((s) => s.collapsed);
  const flash = useUi((s) => s.flash);
  const maskTarget = useUi((s) => s.maskTarget);
  const rows = layerRows(doc.layers, new Set(collapsed));
  const sel = snap.selection;
  const primary = sel.length ? findLayer(doc.layers, sel[sel.length - 1])?.layer : undefined;
  const [renaming, setRenaming] = useState<string | null>(null);
  const tap = useRef(tapTracker());
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [drop, setDrop] = useState<{ id: string; where: DropWhere } | null>(null);
  const dragIds = useRef<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const set = (id: string, v: Record<string, unknown>, coalesce?: string) => api.edit([{ op: "updateLayer", id, set: v }], coalesce ? { coalesce } : {});

  const onRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && sel.length) {
      // Range in the visible rows.
      const ids = rows.map((r) => r.layer.id);
      const a = ids.indexOf(sel[sel.length - 1]);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) return store.select([...new Set([...sel, ...ids.slice(Math.min(a, b), Math.max(a, b) + 1)])].filter((x) => x !== id).concat(id));
    }
    if (e.metaKey || e.ctrlKey) return store.toggleSelect(id);
    store.select(id);
  };

  const add = (kind: "text" | "shape" | "solid" | "gradient" | "adjustment" | "group") => {
    const pos = insertPosition(doc, store.primary);
    const W = doc.canvas.width;
    const H = doc.canvas.height;
    let layer: Layer;
    if (kind === "text") {
      setTool(api, "text");
      ui.set({ textEdit: { id: null, x: W * 0.1, y: H * 0.1 } });
      return;
    }
    if (kind === "shape") layer = shapeLayer(doc, "rect", { x: W * 0.3, y: H * 0.3, width: W * 0.4, height: H * 0.4 }, ui.get().fg);
    else if (kind === "solid") layer = { id: newId(doc, "fill"), type: "fill", name: t("layers.solidName"), fill: ui.get().fg };
    else if (kind === "gradient") layer = { id: newId(doc, "gradient"), type: "fill", name: t("layers.gradientName"), fill: { type: "linear", angle: 90, stops: [[0, "#00000000"], [1, "#000000cc"]] } };
    else if (kind === "adjustment") layer = { id: newId(doc, "adjustment"), type: "adjustment", name: t("layers.adjustmentName"), filters: [{ type: "brightnessContrast", brightness: 0, contrast: 0 }] };
    else layer = { id: newId(doc, "group"), type: "group", name: defaultName("group"), children: [] };
    if (api.edit([{ op: "addLayer", layer, ...pos }], { select: layer.id })) ui.set({ rightTab: kind === "adjustment" ? "filters" : "properties" });
  };

  const menuFor = (id: string): MenuEntry[] => {
    const l = findLayer(doc.layers, id)?.layer;
    if (!l) return [];
    return [
      { label: t("layers.duplicate"), icon: <Copy size={13} />, keys: `${MOD}D`, run: () => duplicateSelection(api) },
      { label: t("layers.group"), icon: <FolderPlus size={13} />, keys: `${MOD}G`, run: () => groupSelection(api) },
      { label: t("layers.ungroup"), icon: <Ungroup size={13} />, keys: `⇧${MOD}G`, disabled: l.type !== "group", run: () => ungroupSelection(api) },
      "-",
      { label: l.clip ? t("layers.unclip") : t("layers.clip"), icon: <ArrowDownToLine size={13} />, run: () => set(id, { clip: l.clip ? null : true }) },
      { label: l.locked ? t("layers.unlock") : t("layers.lock"), icon: l.locked ? <LockOpen size={13} /> : <Lock size={13} />, run: () => set(id, { locked: l.locked ? null : true }) },
      { label: l.visible === false ? t("layers.show") : t("layers.hide"), icon: l.visible === false ? <Eye size={13} /> : <EyeOff size={13} />, run: () => set(id, { visible: l.visible === false ? null : false }) },
      "-",
      { label: t("layers.maskInvert"), icon: <SquareDashed size={13} />, disabled: !l.mask, run: () => l.mask && api.edit([{ op: "setMask", id, mask: { ...l.mask, invert: !l.mask.invert } }]) },
      { label: t("layers.maskRemove"), icon: <Square size={13} />, disabled: !l.mask, run: () => api.edit([{ op: "setMask", id, mask: null }]) },
      { label: t("layers.rasterize"), icon: <Layers size={13} />, disabled: !(l.type === "text" || l.type === "shape" || l.type === "fill"), run: () => void rasterizeLayer(api, id) },
      "-",
      { label: t("layers.delete"), icon: <Trash2 size={13} />, keys: "⌫", danger: true, run: () => deleteSelection(api) },
    ];
  };

  const onDragOver = (e: React.DragEvent, l: Layer) => {
    if (!dragIds.current.length) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    const where: DropWhere = l.type === "group" && f > 0.3 && f < 0.7 ? "inside" : f < 0.5 ? "above" : "below";
    if (drop?.id !== l.id || drop.where !== where) setDrop({ id: l.id, where });
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const d = drop;
    setDrop(null);
    if (!d) return;
    const ops = moveOps(doc, dragIds.current, d.id, d.where);
    dragIds.current = [];
    if (ops) api.edit(ops);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={t("layers.title")}>
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pl-3 pr-1.5">
        <span className="panel-title">{t("layers.title")}</span>
        <span className="text-2xs text-fg-faint">{rows.length}</span>
        <div className="ml-auto flex items-center">
          <AddMenu onAdd={add} onImage={() => fileInput.current?.click()} />
          <IconButton label={t("layers.group")} shortcut={`${MOD}G`} disabled={!sel.length} onClick={() => groupSelection(api)} className="h-6 w-6">
            <FolderPlus size={13} />
          </IconButton>
          <IconButton label={t("layers.delete")} shortcut="⌫" disabled={!sel.length} onClick={() => deleteSelection(api)} className="h-6 w-6 hover:text-danger">
            <Trash2 size={13} />
          </IconButton>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) await api.importImages(await readFiles(files));
          }}
        />
      </div>

      {primary && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2.5 py-1.5">
          <Select value={primary.blend ?? "normal"} options={BLEND_MODES.map((b) => ({ value: b, label: blendTitle(b) }))} onChange={(v) => set(primary.id, { blend: v === "normal" ? null : v })} className="w-[112px] flex-none" ariaLabel={t("layers.blend")} />
          <span className="text-2xs text-fg-faint">{t("layers.opacity")}</span>
          <SliderField value={Math.round((primary.opacity ?? 1) * 100)} min={0} max={100} integer onChange={(v, final) => set(primary.id, { opacity: v >= 100 ? null : v / 100 }, final ? undefined : `opacity:${primary.id}`)} ariaLabel={t("layers.opacity")} />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto py-1" onDragLeave={(e) => e.currentTarget === e.target && setDrop(null)}>
        {rows.map(({ layer: l, depth }) => {
          const Icon = l.type === "group" && !collapsed.includes(l.id) ? FolderOpen : TYPE_ICON[l.type];
          const selected = sel.includes(l.id);
          const hidden = l.visible === false;
          const flashing = flash && flash.ids.includes(l.id) && Date.now() - flash.at < 2500;
          return (
            <div
              key={`${l.id}${flashing ? flash!.at : ""}`}
              data-layer={l.id}
              draggable={renaming !== l.id}
              onDragStart={(e) => {
                dragIds.current = sel.includes(l.id) ? sel : [l.id];
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", l.id);
              }}
              onDragEnd={() => ((dragIds.current = []), setDrop(null))}
              onDragOver={(e) => onDragOver(e, l)}
              onDrop={onDrop}
              onClick={(e) => onRowClick(e, l.id)}
              onDoubleClick={() => (l.type === "text" ? (setTool(api, "move"), ui.set({ textEdit: { id: l.id } })) : undefined)}
              onPointerUp={(e) => {
                // Touch: double tap a text layer → its text field in Properties.
                if (l.type === "text" && tap.current(`row:${l.id}`, e)) ui.set({ rightTab: "properties" });
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!sel.includes(l.id)) store.select(l.id);
                setMenu({ x: e.clientX, y: e.clientY, id: l.id });
              }}
              className={clsx(
                "group relative mx-1 flex h-[38px] cursor-default select-none items-center gap-1.5 rounded-md pr-1.5",
                selected ? "bg-accent/15" : "hover:bg-ink-2",
                flashing && "row-flash",
                drop?.id === l.id && drop.where === "inside" && "ring-1 ring-inset ring-accent",
              )}
              style={{ paddingLeft: 4 + depth * 14 }}
            >
              {drop?.id === l.id && drop.where !== "inside" && <div className={clsx("pointer-events-none absolute inset-x-1 h-0.5 rounded bg-accent", drop.where === "above" ? "-top-px" : "-bottom-px")} />}
              <button
                type="button"
                aria-label={hidden ? t("layers.show") : t("layers.hide")}
                onClick={(e) => (e.stopPropagation(), set(l.id, { visible: hidden ? null : false }))}
                className={clsx("flex h-6 w-5 shrink-0 items-center justify-center rounded", hidden ? "text-fg-faint" : "text-fg-muted hover:text-fg")}
              >
                {hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              {l.type === "group" ? (
                <button type="button" aria-label={t("layers.toggleGroup")} onClick={(e) => (e.stopPropagation(), ui.set((s) => ({ collapsed: s.collapsed.includes(l.id) ? s.collapsed.filter((x) => x !== l.id) : [...s.collapsed, l.id] })))} className="flex h-6 w-3.5 shrink-0 items-center justify-center text-fg-faint hover:text-fg">
                  {collapsed.includes(l.id) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                </button>
              ) : (
                <span className="w-0" />
              )}
              {l.clip && <ArrowDownToLine size={11} className="-ml-0.5 shrink-0 rotate-[-90deg] text-fg-faint" aria-label={t("layers.clipped")} />}
              {l.type === "adjustment" || l.type === "group" || l.type === "text" ? (
                <div className="flex h-[28px] w-[36px] shrink-0 items-center justify-center rounded-[3px] bg-ink-2 text-fg-muted">
                  <Icon size={15} />
                </div>
              ) : (
                <LayerThumb layer={l} w={36} h={28} />
              )}
              {l.mask && (
                <button
                  type="button"
                  title={t("layers.maskChip")}
                  aria-label={t("layers.maskChip")}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.altKey) ui.set((s) => ({ showMask: s.showMask === l.id ? null : l.id }));
                    else if (e.shiftKey) api.edit([{ op: "setMask", id: l.id, mask: toggleEnabled(l.mask!) }]);
                    else {
                      // Target the mask (painting tools paint it), like Photoshop.
                      store.select(l.id);
                      ui.set((s) => ({ maskTarget: s.maskTarget === l.id ? null : l.id }));
                    }
                  }}
                  className={clsx("relative shrink-0 rounded-[3px]", maskTarget === l.id ? "ring-2 ring-accent" : "ring-1", l.mask.enabled === false ? "opacity-50 ring-danger/60" : maskTarget !== l.id && "ring-white/15 hover:ring-accent")}
                >
                  <MaskThumb mask={l.mask} w={22} h={28} frame={l.type === "image" || l.type === "text" || l.type === "shape" ? api.boxes.get(l.id) : doc.canvas} />
                  {l.mask.enabled === false && <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-danger">×</span>}
                </button>
              )}
              <div className="min-w-0 flex-1">
                {renaming === l.id ? (
                  <input
                    autoFocus
                    defaultValue={l.name ?? layerLabel(l)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      setRenaming(null);
                      if (v !== (l.name ?? "")) set(l.id, { name: v || null });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="field h-6"
                  />
                ) : (
                  <div
                    onDoubleClick={(e) => (e.stopPropagation(), setRenaming(l.id))}
                    onPointerUp={(e) => {
                      // Touch: double tap the name to rename.
                      if (tap.current(`name:${l.id}`, e)) (e.stopPropagation(), setRenaming(l.id));
                    }}
                    className={clsx("truncate text-sm", hidden ? "text-fg-faint" : "text-fg")} title={`${layerLabel(l)} · ${l.id}`}>
                    {layerLabel(l)}
                  </div>
                )}
                <div className="flex items-center gap-1 truncate text-2xs text-fg-faint">
                  <Icon size={9} />
                  {t(`layerTypes.${l.type}`)}
                  {(l.blend ?? "normal") !== "normal" && <span>· {blendTitle(l.blend!)}</span>}
                  {(l.opacity ?? 1) < 1 && <span>· {Math.round((l.opacity ?? 1) * 100)}%</span>}
                  {!!l.filters?.length && l.type !== "adjustment" && <span className="text-accent/80">· fx {l.filters.length}</span>}
                </div>
              </div>
              <button
                type="button"
                aria-label={l.locked ? t("layers.unlock") : t("layers.lock")}
                onClick={(e) => (e.stopPropagation(), set(l.id, { locked: l.locked ? null : true }))}
                className={clsx("flex h-6 w-5 shrink-0 items-center justify-center rounded", l.locked ? "text-fg-muted" : "text-fg-faint opacity-0 hover:text-fg group-hover:opacity-100 [@media(hover:none)]:opacity-100")}
              >
                {l.locked ? <Lock size={12} /> : <LockOpen size={12} />}
              </button>
            </div>
          );
        })}
        <button type="button" onClick={() => store.select(null)} className={clsx("mx-1 mt-0.5 flex h-8 w-[calc(100%-8px)] items-center gap-2 rounded-md px-2 text-left text-xs", sel.length ? "text-fg-muted hover:bg-ink-2" : "bg-ink-2 text-fg")}>
          <span className="checker-sm h-4 w-5 rounded-[2px] ring-1 ring-white/10" style={{ background: undefined }} />
          {t("layers.canvas")}
          <span className="ml-auto tabular-nums text-fg-faint">
            {doc.canvas.width}×{doc.canvas.height}
          </span>
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuFor(menu.id)} onClose={() => setMenu(null)} />}
    </section>
  );
}

function AddMenu({ onAdd, onImage }: { onAdd(kind: "text" | "shape" | "solid" | "gradient" | "adjustment" | "group"): void; onImage(): void }) {
  const { t } = useI18n();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <IconButton
        label={t("layers.add")}
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos({ x: r.left - 160, y: r.bottom + 4 });
        }}
        className="h-6 w-6"
      >
        <Plus size={14} />
      </IconButton>
      {pos && (
        <ContextMenu
          x={pos.x}
          y={pos.y}
          onClose={() => setPos(null)}
          items={[
            { label: t("layers.addImage"), icon: <ImageIcon size={13} />, run: onImage },
            { label: t("layers.addText"), icon: <Type size={13} />, keys: "T", run: () => onAdd("text") },
            { label: t("layers.addShape"), icon: <Shapes size={13} />, keys: "U", run: () => onAdd("shape") },
            "-",
            { label: t("layers.addSolid"), icon: <Paintbrush size={13} />, run: () => onAdd("solid") },
            { label: t("layers.addGradient"), icon: <Paintbrush size={13} />, run: () => onAdd("gradient") },
            { label: t("layers.addAdjustment"), icon: <SlidersHorizontal size={13} />, run: () => onAdd("adjustment") },
            { label: t("layers.addGroup"), icon: <Folder size={13} />, run: () => onAdd("group") },
          ]}
        />
      )}
    </>
  );
}
