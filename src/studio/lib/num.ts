// Number helpers for inputs.

export function clampNumber(spec: { min?: number; max?: number; integer?: boolean }, n: number): number {
  let v = n;
  if (spec.min !== undefined) v = Math.max(spec.min, v);
  if (spec.max !== undefined) v = Math.min(spec.max, v);
  if (spec.integer) v = Math.round(v);
  return v;
}

// Pretty number for inputs: no float noise (0.30000000000000004 → 0.3).
export function formatNumber(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return "0";
  const f = Number(n.toFixed(digits));
  return Object.is(f, -0) ? "0" : String(f);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

export const round = (n: number, digits = 0) => {
  const k = 10 ** digits;
  return Math.round(n * k) / k;
};
