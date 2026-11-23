// Inline text editing over the canvas: a contentEditable box styled like the
// layer (font, size, weight, colour, spacing, alignment, wrap width) while the
// renderer skips the layer. Blur / Escape / Cmd+Enter commit.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fontDef } from "../../core/catalog";
import type { TextLayer } from "../../core/types";
import { findLayer } from "../../ops/tree";
import { textLayer } from "../lib/layers";
import { paintColor } from "../lib/paint";
import { useEditor, useSnapshot, useUi } from "../state/context";

export function TextEditor() {
  const api = useEditor();
  const edit = useUi((s) => s.textEdit);
  const view = useUi((s) => s.view);
  const fg = useUi((s) => s.fg);
  const doc = useSnapshot().doc!;
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  const [family, setFamily] = useState<string | null>(null);

  const existing = edit?.id ? (findLayer(doc.layers, edit.id)?.layer as TextLayer | undefined) : undefined;
  // A stable draft for a new layer (props only; the id is assigned on commit).
  const [draft] = useState<TextLayer | null>(() => (edit && "x" in edit ? textLayer(doc, { x: edit.x, y: edit.y }, "", { color: fg }) : null));
  const layer = existing ?? draft;
  const box = existing ? api.boxes.get(existing.id) : null;

  useEffect(() => {
    if (!layer) return;
    const def = fontDef(layer.font ?? "inter");
    void api.engine.loader
      .font?.(layer.font ?? "inter", layer.weight ?? 400, !!layer.italic)
      .then((f) => setFamily(f ?? def?.family ?? null))
      .catch(() => setFamily(def?.family ?? null));
  }, [api, layer?.font, layer?.weight, layer?.italic]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !layer) return;
    el.innerText = layer.text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (!layer.text) range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Mount only: later layer changes must not reset what the user types.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!edit || !layer) return null;

  const commit = () => {
    if (done.current) return;
    done.current = true;
    const text = (ref.current?.innerText ?? "").replace(/\n$/, "");
    const cur = api.store.doc!;
    if (existing) {
      if (!text.trim()) api.edit([{ op: "removeLayer", id: existing.id }], { select: null });
      else if (text !== existing.text) api.edit([{ op: "updateLayer", id: existing.id, set: { text } }]);
    } else if (text.trim()) {
      const l = textLayer(cur, { x: layer.x ?? 0, y: layer.y ?? 0 }, text, { color: paintColor(layer.color, fg), size: layer.size });
      const above = api.store.primary;
      api.edit([{ op: "addLayer", layer: l, ...(above ? { above } : {}) }], { select: l.id });
    }
    api.ui.set({ textEdit: null });
  };

  const z = view.zoom;
  const x = box?.x ?? layer.x ?? 0;
  const y = box?.y ?? layer.y ?? 0;
  const size = (layer.size ?? 64) * z;
  const tr = layer.transform === "uppercase" ? "uppercase" : layer.transform === "lowercase" ? "lowercase" : "none";
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      role="textbox"
      aria-multiline
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          ref.current?.blur();
        }
      }}
      className="absolute z-10 cursor-text outline outline-1 outline-offset-2 outline-accent/80"
      style={{
        left: view.x + x * z,
        top: view.y + y * z,
        minWidth: Math.max(8, size * 0.5),
        width: layer.width ? layer.width * z : undefined,
        whiteSpace: layer.width ? "pre-wrap" : "pre",
        fontFamily: family ? `"${family}", sans-serif` : "sans-serif",
        fontSize: size,
        fontWeight: layer.weight ?? 400,
        fontStyle: layer.italic ? "italic" : "normal",
        lineHeight: layer.lineHeight ?? 1.2,
        letterSpacing: (layer.letterSpacing ?? 0) * z,
        textAlign: layer.align ?? "left",
        textTransform: tr,
        color: paintColor(layer.color, "#ffffff"),
        caretColor: "rgb(var(--accent))",
        transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
        transformOrigin: "center",
        background: layer.background?.color,
        textShadow: "0 0 1px rgb(0 0 0 / 0.15)",
      }}
    />
  );
}
