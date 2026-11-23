// "Did you mean …?" helpers shared by validation, ops and AI tools.

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Closest option, or undefined when nothing is reasonably close.
export function closest(input: string, options: Iterable<string>): string | undefined {
  const low = input.toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const opt of options) {
    const o = opt.toLowerCase();
    if (o === low) return opt;
    let d = levenshtein(low, o);
    // Prefix / containment matches ("rot" → "rotate", "torusknot" → "torusKnot").
    if (o.startsWith(low) || low.startsWith(o)) d = Math.min(d, 1.5);
    else if (low.length >= 4 && (o.includes(low) || low.includes(o))) d = Math.min(d, 2);
    if (d < bestScore) {
      bestScore = d;
      best = opt;
    }
  }
  const max = Math.max(2, Math.floor(low.length / 3));
  return bestScore <= max ? best : undefined;
}

// `Did you mean "x"? ` prefix (empty when no suggestion).
export function didYouMean(input: string, options: Iterable<string>): string {
  const s = closest(input, options);
  return s ? `Did you mean "${s}"? ` : "";
}

// "a", "b", "c" — capped list for messages.
export function listOptions(options: readonly string[], max = 40): string {
  const shown = options.slice(0, max).map((o) => `"${o}"`).join(", ");
  return options.length > max ? `${shown}, … (${options.length} total)` : shown;
}
