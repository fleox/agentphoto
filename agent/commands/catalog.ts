import { CATALOG, type CatalogSection } from "../../src/core/catalog";
import { readTemplateFiles, readTemplatesIndex } from "../host";
import { NodeFs } from "../nodeFs";
import { CliError, printResult } from "../output";
import type { Command } from "./types";
import { positional, projectDir, table, tool, usage } from "./util";

const SECTIONS = Object.keys(CATALOG) as CatalogSection[];

const idOf = (e: unknown): string => (typeof e === "string" ? e : ((e as { id?: string }).id ?? ""));

export const catalogCommand: Command = {
  name: "catalog",
  usage: "catalog [<section>] [<id>]",
  summary: `What documents can use, with parameters: ${SECTIONS.join(", ")}. No section → an overview; a section → its entries; an id → the full entry (params, types, ranges, defaults).`,
  options: [],
  async run({ io, positionals }) {
    const [section, id] = positionals;
    if (section) {
      const key = SECTIONS.find((s) => s.toLowerCase() === section.toLowerCase() || s.toLowerCase() === `${section.toLowerCase()}s`);
      if (!key) usage(`Unknown catalog section "${section}".`, `Sections: ${SECTIONS.join(", ")}.`);
    }
    // catalog_get is the single implementation (overview, sections, entries + suggestions).
    const r = await tool<Record<string, unknown>>(new NodeFs(projectDir({})), "catalog_get", { ...(section ? { section: SECTIONS.find((s) => s.toLowerCase() === section.toLowerCase() || s.toLowerCase() === `${section.toLowerCase()}s`) } : {}), ...(id ? { id } : {}) });
    if (!section) return printResult(io, r, () => Object.entries(r.sections as Record<string, string[] | readonly string[]>).map(([k, v]) => `${k}:\n${v.map((x) => `  ${x}`).join("\n")}`).join("\n\n"));
    if (!id) {
      const entries = r.entries as unknown[];
      return printResult(io, r, () => table(entries.map((e) => ({ id: idOf(e), description: typeof e === "string" ? "" : (e as { description?: string }).description })), ["id", "description"]));
    }
    return printResult(io, r, () => JSON.stringify(r.entry, null, 2));
  },
};

export const templatesCommand: Command = {
  name: "templates",
  usage: "templates <list|show> [<id>] [--category <c>] [--query <text>]",
  summary: "Starter templates (`agentphoto new <dir> --template <id> [--image <photo>]`): list them, or show one (metadata, files and its document summary).",
  subcommands: [
    { name: "list", usage: "templates list [--category <c>] [--query <text>]", summary: "Templates with id, category, size, slot (the layer that receives your photo) and description." },
    { name: "show", usage: "templates show <id>", summary: "A template's metadata, files and document summary." },
  ],
  options: [
    { name: "category", type: "string", description: "list: social, ad, thumbnail, product, portrait, print, web…" },
    { name: "query", type: "string", description: "list: words to look for." },
  ],
  async run({ io, options, positionals }) {
    const [action = "list"] = positionals;
    const fs = new NodeFs(projectDir({}));
    if (action === "list") {
      const r = await tool<{ templates: { id: string; category: string; width: number; height: number; slot?: string; title: string }[] }>(fs, "templates_list", { ...(typeof options.category === "string" ? { category: options.category } : {}), ...(typeof options.query === "string" ? { query: options.query } : {}) });
      return printResult(io, r, () => table(r.templates.map((t) => ({ ...t, size: `${t.width}×${t.height}` })) as unknown as Record<string, unknown>[], ["id", "category", "size", "slot", "title"]));
    }
    if (action === "show") {
      const id = positional(positionals, 1, "template id", "templates show <id>");
      const meta = readTemplatesIndex().find((t) => t.id === id);
      const files = readTemplateFiles(id);
      const raw = files["photo.json"];
      if (!meta || !raw) throw new CliError("notFound", `Template "${id}" has no photo.json.`, "`agentphoto templates list` lists the templates.");
      let summary: unknown = null;
      try {
        const { summarizeDoc } = await import("../../src/ops/doc");
        const { normalizeDoc } = await import("../../src/core/validate");
        summary = summarizeDoc(normalizeDoc(JSON.parse(new TextDecoder().decode(raw))));
      } catch {
        summary = null;
      }
      return printResult(io, { template: meta, files: Object.keys(files), summary }, () => `${meta.title} (${id}, ${meta.width}×${meta.height}${meta.slot ? `, photo slot "${meta.slot}"` : ""})\n${meta.description}\nFiles: ${Object.keys(files).join(", ")}`);
    }
    usage(`Unknown templates action "${action}".`, "Use list or show.");
  },
};
