import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { IconButton } from "./controls";
import { t } from "../../i18n";

export function Dialog({ title, onClose, children, footer, width = 560 }: { title: ReactNode; onClose(): void; children: ReactNode; footer?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className="toast-in flex max-h-[86vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-ink-1 shadow-2xl shadow-black/50 outline-none focus-visible:outline-none" style={{ maxWidth: width }}>
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
          <div className="text-base font-semibold">{title}</div>
          <IconButton label={t("ui.close")} onClick={onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer && <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}
