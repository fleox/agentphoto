// Toasts: transient messages bottom-centre of the viewport. `tone: "agent"`
// marks changes made by someone else (an AI agent in a terminal).

import clsx from "clsx";
import { Bot, CircleAlert, Check, Info } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

export type ToastTone = "info" | "success" | "error" | "agent";
export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
  action?: { label: string; run(): void };
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(t: Omit<ToastItem, "id">, ms = 4200): number {
  const id = ++seq;
  items = [...items.slice(-3), { ...t, id }];
  emit();
  setTimeout(() => dismiss(id), ms);
  return id;
}
export function dismiss(id: number): void {
  items = items.filter((x) => x.id !== id);
  emit();
}

const ICONS: Record<ToastTone, ReactNode> = {
  info: <Info size={14} className="text-accent" />,
  success: <Check size={14} className="text-agent" />,
  error: <CircleAlert size={14} className="text-danger" />,
  agent: <Bot size={14} className="text-agent" />,
};

export function Toaster() {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
  );
  return (
    <div aria-live="polite" className="pointer-events-none absolute bottom-3 left-1/2 z-40 flex w-[min(420px,90%)] -translate-x-1/2 flex-col items-center gap-1.5">
      {list.map((t) => (
        <div key={t.id} className={clsx("toast-in pointer-events-auto flex w-full items-start gap-2 rounded-lg border bg-ink-1/95 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur", t.tone === "agent" ? "border-agent/40" : t.tone === "error" ? "border-danger/40" : "border-line")}>
          <div className="mt-0.5">{ICONS[t.tone]}</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{t.title}</div>
            {t.detail && <div className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{t.detail}</div>}
          </div>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
              className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-ink-3"
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
