// The public site (site/, scripts/build-site.mjs): both guides have the same
// structure, the pages render, and the wording follows the repo-presentation
// rules (source available, no hosted service, the RMBG-1.4 licence).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ES modules without types
import en from "../site/content/en.mjs";
// @ts-expect-error plain ES modules without types
import fr from "../site/content/fr.mjs";
// @ts-expect-error plain ES modules without types
import { appHead, guidePage, notFoundPage, SITE_URL } from "../site/render.mjs";

const shape = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(shape) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v;

describe("site", () => {
  it("has the same structure in English and French", () => {
    expect(shape(fr)).toEqual(shape(en));
    expect(fr.features.items.map((f: { id: string; shot: string }) => [f.id, f.shot])).toEqual(en.features.items.map((f: { id: string; shot: string }) => [f.id, f.shot]));
  });

  it("has a screenshot for every feature, in both languages", () => {
    for (const c of [en, fr])
      for (const f of c.features.items) expect(existsSync(join(__dirname, "..", "site", "img", c.lang, `${f.shot}.jpg`)), `${c.lang}/${f.shot}`).toBe(true);
  });

  it("renders the guides with SEO tags, structured data and the agent install", () => {
    for (const c of [en, fr]) {
      const html: string = guidePage(c, { version: "9.9.9" });
      expect(html).toContain(`<html lang="${c.lang}">`);
      expect(html).toContain(`<link rel="canonical" href="${SITE_URL}${c.path}">`);
      expect(html).toContain('hreflang="fr"');
      expect(html).toContain('"@type":"FAQPage"');
      expect(html).toContain("/plugin marketplace add fleox/agentphoto");
      expect(html).toContain("npx -y @fleox/agentphoto@9.9.9 mcp");
      expect(html).toContain("https://github.com/fleox/agentphoto");
      expect(html).not.toMatch(/<[a-z]+[^>]*\s(src|href)="(?!\/|https:\/\/|#|data:)[^"]*"/);
    }
    expect(notFoundPage()).toContain('content="noindex"');
    expect(appHead()).toContain("<title>");
    // Google Analytics on every page of the public site, disclosed in the FAQ.
    for (const html of [appHead(), notFoundPage(), guidePage(en, { version: "1" }), guidePage(fr, { version: "1" })]) expect(html).toContain("googletagmanager.com/gtag/js?id=G-JE88WG1Z5R");
    for (const c of [en, fr]) expect(JSON.stringify(c.faq)).toContain("Google Analytics");
  });

  it("follows the wording rules", () => {
    const text = JSON.stringify([en, fr]);
    expect(text).not.toMatch(/open[- ]source|cloud|offline|hors ligne/i);
    expect(text).toContain("PolyForm Noncommercial 1.0.0");
    for (const c of [en, fr]) expect(JSON.stringify(c.faq)).toMatch(/RMBG-1\.4.*(non-commercial|non commerciale)/);
  });
});
