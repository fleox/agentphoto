// Best-effort lint: user-facing strings in Studio components go through the
// i18n bundles (t("…")), so a French UI is fully French. Flags literal text in
// JSX and literal title / placeholder / aria-label / label / hint / alt
// attributes. Technical tokens (acronyms, ids, key codes, file names) are allowed.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".tsx") ? [join(dir, f)] : []));

const ALLOWED = new Set(["AgentPhoto Studio", "sk-ant-…", "—", "RGB", "Aa", "Promise"]);

export function findings(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
  const out: string[] = [];
  for (const m of code.matchAll(/\b(title|placeholder|aria-label|label|ariaLabel|hint|alt)="([^"]*)"/g)) {
    const v = m[2];
    if (/[A-Za-z]{2,}/.test(v) && !ALLOWED.has(v) && !/^[a-z][A-Za-z0-9.]*$/.test(v)) out.push(`${m[1]}="${v}"`);
  }
  for (const m of code.matchAll(/>\s*([A-Za-z][A-Za-z ,.'’!?…:-]{2,})\s*<\/?[A-Za-z]/g)) {
    const v = m[1].trim();
    if (/\b(as|=>|return|const)\b/.test(v) || ALLOWED.has(v)) continue;
    if (/^[a-z]+(\.[a-z]+)+$/i.test(v)) continue;
    if (/[a-z]{3,}/.test(v) && /^[A-Z]/.test(v)) out.push(`text "${v}"`);
  }
  return out;
}

describe("studio i18n coverage", () => {
  it("components have no hard-coded user-facing English strings", () => {
    const bad = files(ROOT).flatMap((f) => findings(readFileSync(f, "utf8")).map((x) => `${relative(ROOT, f)}: ${x}`));
    expect(bad).toEqual([]);
  });
  it("the lint catches literals", () => {
    expect(findings('<button title="Delete it">x</button>')).toEqual(['title="Delete it"']);
    expect(findings("<span>\n  Save changes\n</span>")).toEqual(['text "Save changes"']);
    expect(findings('<IconButton label={t("ui.close")} />')).toEqual([]);
  });
});
