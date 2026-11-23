// Context / dropdown menu rendered in a portal at a screen position.

import clsx from "clsx";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type MenuEntry = { label: string; icon?: ReactNode; keys?: string; danger?: boolean; disabled?: boolean; run(): void } | "-";

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), onClose());
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} role="menu" className="toast-in fixed z-[60] min-w-[200px] rounded-lg border border-line bg-ink-1 py-1 shadow-xl shadow-black/50" style={pos}>
      {items.map((it, i) =>
        it === "-" ? (
          <div key={i} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.run();
            }}
            className={clsx("flex w-full items-center gap-2 px-2.5 py-1 text-left text-sm disabled:opacity-35", it.danger ? "text-danger hover:bg-danger/10" : "hover:bg-ink-3")}
          >
            <span className="flex w-4 justify-center text-fg-muted">{it.icon}</span>
            <span className="flex-1">{it.label}</span>
            {it.keys && <span className="text-2xs text-fg-faint">{it.keys}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
