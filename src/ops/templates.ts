// Templates: starter projects in templates/<id>/ (photo.json, template.json,
// preview.jpg, optional assets/). The front door (CLI: package folder,
// Studio: API) reads the index and the files; ops only filter and
// instantiate them (createProject with templateFiles). template.json may name
// a `slot`: the image layer that receives the user's photo.

import type { ProjectFs } from "../core/fs";
import { closest } from "../core/suggest";
import { OpsError } from "./context";
import { ANCHORS, type Anchor } from "./geometry";
import { createProject, type CreateProjectResult, type NewImage } from "./project";

export interface TemplateInfo {
  id: string;
  title: string;
  description: string;
  // Use case: social, ad, thumbnail, product, portrait, print, web…
  category: string;
  tags: string[];
  width: number;
  height: number;
  // Image layer replaced by the user's photo.
  slot?: string;
  // Where a cut-out subject belongs (canvas px): the first remove_background
  // on the slot after a photo swap scales and moves the layer so the subject
  // fits this box, aligned on `anchor` (e.g. "bottom" = standing on a floor).
  subjectArea?: { x: number; y: number; width: number; height: number; anchor?: Anchor };
}

export type TemplateIndex = TemplateInfo[];

export function listTemplates(index: TemplateIndex, filter: { category?: string; query?: string } = {}): TemplateInfo[] {
  const words = (filter.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return (index ?? []).filter((t) => {
    if (filter.category && t.category !== filter.category) return false;
    const hay = `${t.id} ${t.title} ${t.description} ${t.category} ${t.tags.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function findTemplate(index: TemplateIndex, id: string): TemplateInfo {
  const t = (index ?? []).find((x) => x.id === id);
  if (!t) {
    const s = closest(id, (index ?? []).map((x) => x.id));
    throw new OpsError("notFound", `Unknown template "${id}".`, `${s ? `Did you mean "${s}"? ` : ""}List templates with templates_list / \`agentphoto templates list\`.`);
  }
  return t;
}

export function parseTemplateInfo(json: unknown, fallbackId: string): TemplateInfo {
  const t = (json ?? {}) as Partial<TemplateInfo>;
  return {
    id: typeof t.id === "string" ? t.id : fallbackId,
    title: typeof t.title === "string" ? t.title : fallbackId,
    description: typeof t.description === "string" ? t.description : "",
    category: typeof t.category === "string" ? t.category : "other",
    tags: Array.isArray(t.tags) ? t.tags.map(String) : [],
    width: typeof t.width === "number" ? t.width : 1200,
    height: typeof t.height === "number" ? t.height : 630,
    ...(typeof t.slot === "string" ? { slot: t.slot } : {}),
    ...(subjectArea(t.subjectArea) ? { subjectArea: subjectArea(t.subjectArea)! } : {}),
  };
}

function subjectArea(v: unknown): TemplateInfo["subjectArea"] | null {
  if (!v || typeof v !== "object") return null;
  const a = v as Record<string, unknown>;
  if (!["x", "y", "width", "height"].every((k) => typeof a[k] === "number" && Number.isFinite(a[k]))) return null;
  if (!((a.width as number) >= 1 && (a.height as number) >= 1)) return null;
  const anchor = ANCHORS.includes(a.anchor as Anchor) ? (a.anchor as Anchor) : undefined;
  return { x: a.x as number, y: a.y as number, width: a.width as number, height: a.height as number, ...(anchor ? { anchor } : {}) };
}

export async function instantiateTemplate(fs: ProjectFs, id: string, files: Record<string, Uint8Array | string>, opts: { name: string; title?: string; force?: boolean; image?: NewImage }): Promise<CreateProjectResult> {
  return createProject(fs, { name: opts.name, title: opts.title, template: id, templateFiles: files, force: opts.force, image: opts.image });
}
