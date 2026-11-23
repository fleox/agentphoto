import { describe, expect, it } from "vitest";
import { en } from "./en";
import { fr } from "./fr";
import { translate } from "./index";

function keys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("studio i18n", () => {
  it("fr has exactly the en keys", () => {
    const e = keys(en).sort();
    const f = keys(fr).sort();
    expect({ missing: e.filter((k) => !f.includes(k)), extra: f.filter((k) => !e.includes(k)) }).toEqual({ missing: [], extra: [] });
  });
  it("interpolates and keeps placeholders consistent", () => {
    expect(translate("en", "status.errors", { n: 3 })).toBe("3 errors");
    expect(translate("fr", "status.errors", { n: 3 })).toBe("3 erreurs");
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    const flat = (o: unknown, p = ""): [string, string][] => (typeof o === "string" ? [[p, o]] : Object.entries(o as object).flatMap(([k, v]) => flat(v, p ? `${p}.${k}` : k)));
    const frMap = new Map(flat(fr));
    for (const [k, v] of flat(en)) expect([k, vars(frMap.get(k) ?? "")]).toEqual([k, vars(v)]);
  });
});
