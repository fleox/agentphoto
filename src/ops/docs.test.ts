// docs/catalog.md must match renderCatalogMarkdown(). Regenerate with:
//   UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOG } from "../core/catalog";
import { renderCatalogMarkdown } from "./docs";

const file = fileURLToPath(new URL("../../docs/catalog.md", import.meta.url));

describe("docs/catalog.md", () => {
  it("mentions every catalog id and value", () => {
    const md = renderCatalogMarkdown();
    for (const [section, list] of Object.entries(CATALOG)) {
      for (const e of list as readonly unknown[]) {
        const id = typeof e === "string" ? e : (e as { id?: string; name?: string }).id ?? (e as { name: string }).name;
        expect(md, `${section}: ${id}`).toContain(`\`${id}\``);
      }
    }
    for (const f of CATALOG.filters) for (const p of f.params) expect(md, `${f.id}.${p.name}`).toContain(`| \`${p.name}\` |`);
    for (const m of CATALOG.models) expect(md).toContain(m.license);
  });
  it("is up to date (UPDATE_DOCS=1 to rewrite)", () => {
    const md = renderCatalogMarkdown();
    if (process.env.UPDATE_DOCS === "1") writeFileSync(file, md);
    expect(existsSync(file), "docs/catalog.md missing — run UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts").toBe(true);
    expect(readFileSync(file, "utf8"), "docs/catalog.md is stale — run UPDATE_DOCS=1 npx vitest run src/ops/docs.test.ts").toBe(md);
  });
});
