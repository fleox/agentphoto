// Bottom status bar: canvas size, zoom, cursor position, selected layer box, render time.

import { Crosshair, Gauge, Maximize2, ScanLine, ZoomIn } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useI18n } from "../i18n";
import { useEditor, useSnapshot, useUi } from "../state/context";

export function StatusBar() {
  const { t } = useI18n();
  const api = useEditor();
  const snap = useSnapshot();
  const zoom = useUi((s) => s.view.zoom);
  const cursor = useUi((s) => s.cursor);
  const ms = useUi((s) => s.renderMs);
  const boxes = useSyncExternalStore(api.boxes.subscribe, api.boxes.getSnapshot);
  const doc = snap.doc!;
  const sel = snap.selection[snap.selection.length - 1];
  const b = sel ? boxes.get(sel) : undefined;
  const issues = snap.issues.filter((i) => i.severity === "error");
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-ink-1 px-3 text-2xs tabular-nums text-fg-faint">
      <span className="flex items-center gap-1" title={t("status.canvas")}>
        <Maximize2 size={10} /> {doc.canvas.width} × {doc.canvas.height} px
      </span>
      <span className="flex items-center gap-1" title={t("status.zoom")}>
        <ZoomIn size={10} /> {Math.round(zoom * 1000) / 10}%
      </span>
      <span className="flex w-[92px] items-center gap-1" title={t("status.cursor")}>
        <Crosshair size={10} /> {cursor ? `${cursor.x}, ${cursor.y}` : "—"}
      </span>
      {b && (
        <span className="flex items-center gap-1" title={t("status.selection")}>
          <ScanLine size={10} />
          {Math.round(b.x)}, {Math.round(b.y)} · {Math.round(b.width)} × {Math.round(b.height)}
          {b.rotation ? ` · ${b.rotation}°` : ""}
        </span>
      )}
      {issues.length > 0 && <span className="text-danger">{t("status.errors", { n: issues.length })}</span>}
      <span className="ml-auto flex items-center gap-1" title={t("status.render")}>
        <Gauge size={10} /> {ms} ms
      </span>
    </footer>
  );
}
