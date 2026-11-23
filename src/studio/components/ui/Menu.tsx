// Searchable pick list in a popover (add behaviour, add post effect…).

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  id: string;
  label: string;
  hint?: string;
}

export function PickMenu({ trigger, items, onPick, placeholder, align = "right" }: { trigger: (open: () => void) => ReactNode; items: MenuItem[]; onPick(id: string): void; placeholder: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? items.filter((i) => i.label.toLowerCase().includes(s) || i.hint?.toLowerCase().includes(s)) : items;
  }, [items, q]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const pick = (id: string) => {
    setOpen(false);
    setQ("");
    onPick(id);
  };
  return (
    <div ref={root} className="relative">
      {trigger(() => {
        setOpen((o) => !o);
        setActive(0);
      })}
      {open && (
        <div className={`toast-in absolute top-full z-30 mt-1 w-64 overflow-hidden rounded-lg border border-line bg-ink-1 shadow-xl shadow-black/50 ${align === "right" ? "right-0" : "left-0"}`}>
          <input
            autoFocus
            value={q}
            placeholder={placeholder}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setActive((a) => Math.min(filtered.length - 1, a + 1));
              else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
              else if (e.key === "Enter" && filtered[active]) pick(filtered[active].id);
              else if (e.key === "Escape") setOpen(false);
              else return;
              e.preventDefault();
            }}
            className="h-8 w-full border-b border-line bg-transparent px-2.5 text-sm outline-none placeholder:text-fg-faint"
          />
          <div className="max-h-72 overflow-auto py-1">
            {filtered.map((it, i) => (
              <button key={it.id} type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(it.id)} className={`block w-full px-2.5 py-1 text-left ${i === active ? "bg-ink-3" : ""}`}>
                <div className="text-sm">{it.label}</div>
                {it.hint && <div className="truncate text-2xs text-fg-faint">{it.hint}</div>}
              </button>
            ))}
            {!filtered.length && <div className="px-2.5 py-2 text-xs text-fg-faint">—</div>}
          </div>
        </div>
      )}
    </div>
  );
}
