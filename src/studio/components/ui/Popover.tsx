// Popover anchored to a trigger, rendered in a portal with fixed positioning
// (never clipped by the scrolling inspector). Closes on outside click / Escape.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Popover({ trigger, children, width = 280, align = "end", anchorClass = "flex min-w-0" }: { trigger: (open: () => void, isOpen: boolean) => ReactNode; children: (close: () => void) => ReactNode; width?: number; align?: "start" | "end"; anchorClass?: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const place = () => {
      const r = anchor.current!.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = align === "end" ? r.right - width : r.left;
      left = Math.max(8, Math.min(vw - width - 8, left));
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const h = panel.current?.scrollHeight ?? 320;
      if (below >= Math.min(h, 260) || below >= above) setPos({ left, top: r.bottom + 4, maxHeight: below });
      else setPos({ left, top: Math.max(8, r.top - 4 - Math.min(h, above)), maxHeight: above });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.stopPropagation(), setOpen(false));
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <div ref={anchor} className={anchorClass}>
      {trigger(() => setOpen((o) => !o), open)}
      {open &&
        createPortal(
          <div
            ref={panel}
            className="toast-in fixed z-50 overflow-auto rounded-lg border border-line bg-ink-1 shadow-xl shadow-black/50"
            style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999, maxHeight: pos?.maxHeight ?? 400 }}
          >
            {children(close)}
          </div>,
          document.body,
        )}
    </div>
  );
}

// A select-looking button that opens a popover.
export function PickerButton({ onClick, children, open, ariaLabel }: { onClick(): void; children: ReactNode; open?: boolean; ariaLabel?: string }) {
  return (
    <button type="button" aria-label={ariaLabel} aria-expanded={open} onClick={onClick} className={`field flex items-center gap-1.5 text-left ${open ? "border-accent/70 bg-ink-1" : ""}`} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5' viewBox='0 0 8 5'%3E%3Cpath d='M1 1l3 3 3-3' stroke='%23989fae' fill='none' stroke-width='1.2'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center", paddingRight: 18 }}>
      {children}
    </button>
  );
}
