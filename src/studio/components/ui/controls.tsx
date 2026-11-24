// Small, dense form controls for the Studio panels.

import clsx from "clsx";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { t } from "../../i18n";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

type BtnVariant = "ghost" | "subtle" | "primary" | "danger";

export function Button({ variant = "subtle", size = "sm", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "xs" | "sm" | "md" }) {
  return (
    <button
      type="button"
      {...rest}
      className={clsx(
        // Icons never shrink: a label too long for the button must not squeeze its icon into a dot.
        "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 [&>svg]:shrink-0",
        size === "xs" && "h-6 px-2 text-xs",
        size === "sm" && "h-7 px-2.5 text-sm",
        size === "md" && "h-8 px-3.5 text-base",
        variant === "ghost" && "text-fg-muted hover:bg-ink-3 hover:text-fg",
        variant === "subtle" && "bg-ink-3 text-fg hover:bg-ink-4",
        variant === "primary" && "bg-accent text-ink-0 hover:bg-accent/90",
        variant === "danger" && "bg-danger/15 text-danger hover:bg-danger/25",
        className,
      )}
    />
  );
}

export function IconButton({ label, active, className, children, shortcut, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; shortcut?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active}
      {...rest}
      className={clsx(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-35",
        active ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-ink-3 hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

// Text input that commits on blur / Enter (Escape reverts).
export function TextField({ value, onCommit, placeholder, className, multiline, mono, ariaLabel }: { value: string; onCommit(v: string): void; placeholder?: string; className?: string; multiline?: boolean; mono?: boolean; ariaLabel?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const commit = () => draft !== value && onCommit(draft);
  const common = {
    value: draft,
    placeholder,
    "aria-label": ariaLabel,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  };
  if (multiline)
    return (
      <textarea
        {...common}
        rows={2}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
          if (e.key === "Escape") setDraft(value);
        }}
        className={clsx("field h-auto min-h-[44px] resize-y py-1 leading-snug", mono && "font-mono text-xs", className)}
      />
    );
  return (
    <input
      {...common}
      spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      className={clsx("field", mono && "font-mono text-xs", className)}
    />
  );
}

export function Select({ value, options, onChange, className, ariaLabel, placeholder }: { value: string; options: readonly (string | { value: string; label: string })[]; onChange(v: string): void; className?: string; ariaLabel?: string; placeholder?: string }) {
  return (
    <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} className={clsx("field", className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        return (
          <option key={v} value={v}>
            {typeof o === "string" ? o : o.label}
          </option>
        );
      })}
    </select>
  );
}

export function Toggle({ checked, onChange, ariaLabel }: { checked: boolean; onChange(v: boolean): void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={clsx("relative h-4 w-7 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-ink-4")}
    >
      <span className={clsx("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-[left]", checked ? "left-[14px]" : "left-0.5")} />
    </button>
  );
}

// Label + control row. `overridden` shows a dot and a reset button.
export function Row({ label, children, hint, onReset, overridden, align = "center" }: { label: ReactNode; children: ReactNode; hint?: string; onReset?: () => void; overridden?: boolean; align?: "center" | "start" }) {
  return (
    // Label column: 86 px, long labels wrap on two lines (French labels are longer),
    // the full label + hint is the tooltip.
    <div className={clsx("group grid grid-cols-[86px_minmax(0,1fr)_14px] gap-x-2 px-3 py-[3px]", align === "center" ? "items-center" : "items-start")}>
      <div className={clsx("line-clamp-2 break-words text-xs leading-tight text-fg-muted [hyphens:auto]", align === "start" && "pt-1")} title={typeof label === "string" ? (hint ? `${label} — ${hint}` : label) : hint}>
        {label}
      </div>
      <div className="flex min-w-0 items-center gap-1">{children}</div>
      <div className="flex justify-end">
        {onReset && overridden && (
          <button type="button" title={t("ui.reset")} aria-label={t("ui.reset")} onClick={onReset} className="text-fg-faint opacity-0 transition-opacity hover:text-fg group-hover:opacity-100">
            <RotateCcw size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

export function Section({ title, children, defaultOpen = true, actions, id }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; actions?: ReactNode; id?: string }) {
  const key = id ? `agentphoto.section.${id}` : null;
  const [open, setOpen] = useState(() => {
    if (!key) return defaultOpen;
    try {
      const v = localStorage.getItem(key);
      return v === null ? defaultOpen : v === "1";
    } catch {
      return defaultOpen;
    }
  });
  const toggle = () => {
    setOpen((o) => {
      try {
        if (key) localStorage.setItem(key, o ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !o;
    });
  };
  return (
    <section className="border-b border-line">
      <div className="flex h-8 items-center gap-1 pl-2 pr-2">
        <button type="button" onClick={toggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-fg">
          {open ? <ChevronDown size={12} className="text-fg-faint" /> : <ChevronRight size={12} className="text-fg-faint" />}
          <span className="truncate">{title}</span>
        </button>
        {actions}
      </div>
      {open && <div className="pb-2">{children}</div>}
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-ink-2 px-1 font-sans text-2xs text-fg-muted">{children}</kbd>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
      {icon && <div className="text-fg-faint">{icon}</div>}
      <div className="text-sm font-medium text-fg-muted">{title}</div>
      {children && <div className="text-xs text-fg-faint">{children}</div>}
    </div>
  );
}
