// Layer ids: [a-zA-Z][a-zA-Z0-9_-]*, unique across the document.

export const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

// "My Logo 3D!" → "my-logo-3d". Always returns a valid id (prefixes "o" when needed).
export function slugify(text: string, fallback = "item"): string {
  const s = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  if (!s) return fallback;
  return /^[a-z]/.test(s) ? s : `${fallback}-${s}`;
}

// First free id "base", "base-2", "base-3"… not in `taken`.
export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const b = isValidId(base) ? base : slugify(base);
  if (!set.has(b)) return b;
  for (let i = 2; ; i++) if (!set.has(`${b}-${i}`)) return `${b}-${i}`;
}
