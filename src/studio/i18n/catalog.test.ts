// Every catalog entry the Studio shows has a translated label (en and fr).
import { describe, expect, it } from "vitest";
import { EFFECTS, FILTERS, FONTS, LOOKS, SIZE_PRESETS } from "../../core/catalog";
import { BLEND_MODES } from "../../core/types";
import { camel } from "../lib/labels";
import { en } from "./en";
import { fr } from "./fr";

describe("studio labels for the catalog", () => {
  for (const [lang, b] of [["en", en], ["fr", fr]] as const) {
    it(`${lang}: filters, params, looks, effects, sizes, blend modes, font styles`, () => {
      const missing: string[] = [];
      const has = (sec: Record<string, unknown>, k: string, what: string) => !(k in sec) && missing.push(`${what}.${k}`);
      for (const f of FILTERS) {
        has(b.filterNames, f.id, "filterNames");
        has(b.filterGroups, f.group, "filterGroups");
        for (const p of f.params) has(b.params, p.name, "params");
      }
      for (const e of EFFECTS) {
        has(b.effectNames, e.id, "effectNames");
        for (const p of e.params) has(b.params, p.name, "params");
      }
      for (const l of LOOKS) has(b.lookNames, camel(l.id), "lookNames");
      for (const s of SIZE_PRESETS) has(b.sizeNames, camel(s.id), "sizeNames");
      for (const m of BLEND_MODES) has(b.blend, camel(m), "blend");
      for (const f of FONTS) has(b.fontStyles, f.style, "fontStyles");
      expect(missing).toEqual([]);
    });
  }
});
