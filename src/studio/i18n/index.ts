// Tiny i18n helper: nested message bundles (en is the source of truth, fr
// must have the same keys — src/studio/i18n/i18n.test.ts), `{var}`
// interpolation, browser language auto-detection, override in localStorage.

import { useSyncExternalStore } from "react";
import { en, type Messages } from "./en";
import { fr } from "./fr";

export type Lang = "en" | "fr";
export const BUNDLES: Record<Lang, Messages> = { en, fr };
const KEY = "agentphoto.studio.lang";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;

export function detectLang(): Lang {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (q === "en" || q === "fr") return q;
    const saved = localStorage.getItem(KEY);
    if (saved === "en" || saved === "fr") return saved;
  } catch {
    /* storage blocked */
  }
  const nav = typeof navigator !== "undefined" ? navigator.languages?.[0] ?? navigator.language : "en";
  return nav?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current: Lang = detectLang();
const listeners = new Set<() => void>();

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export function getLang(): Lang {
  return current;
}

function lookup(bundle: unknown, key: string): string | undefined {
  let cur = bundle;
  for (const part of key.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = lookup(BUNDLES[lang], key) ?? lookup(en, key) ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : raw;
}

// A message by a key built at run time (e.g. "fields.<param>"), or undefined when no bundle has it.
export function tryTranslate(key: string, lang: Lang = current): string | undefined {
  return lookup(BUNDLES[lang], key) ?? lookup(en, key);
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(current, key, vars);
}

// Re-renders the component when the language changes.
export function useI18n(): { t: typeof t; lang: Lang; setLang: typeof setLang } {
  const lang = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  return { t, lang, setLang };
}
