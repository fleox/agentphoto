import { CliError, printResult } from "../output";
import type { Command } from "./types";
import { absPath, boolOpt, confirmOrPlan, jsonOpt, numOpt, paintValue, positional, PROJECT_OPTION, projectFs, shownDir, strOpt, tool, usage, YES_OPTION, type MutationResult } from "./util";

// The pixel commands (headless Chrome engine): remove-bg, analyze, render,
// export — plus check. All of them are AI tools (src/ai/imageTools.ts).

const log = (m: string) => void process.stderr.write(`${m}\n`);

export const removeBgCommand: Command = {
  name: "remove-bg",
  usage: "remove-bg <layer> [--model rmbg-1.4|modnet] [--background <paint>] [--shadow] [--feather <px>] [--threshold <0-255>] [--fit x,y,w,h|none] [--anchor center|bottom|…]",
  summary: "Remove the background of a photo layer with local AI (nothing is uploaded; the model downloads once): writes a mask to assets/masks/ and sets it on the layer — non-destructive (`mask clear` restores). --background adds a colour / gradient under the cut-out, --shadow a soft drop shadow.",
  writes: true,
  options: [
    PROJECT_OPTION,
    { name: "model", type: "string", description: "rmbg-1.4 (default: products, people, objects) or modnet (portraits)." },
    { name: "background", type: "string", description: 'Colour or gradient JSON placed behind the subject (adds a fill layer), e.g. "#ffffff".' },
    { name: "shadow", type: "boolean", description: "Add a soft drop shadow under the subject." },
    { name: "feather", type: "string", description: "Soften the edge, px." },
    { name: "threshold", type: "string", description: "Hard edge: keep pixels with confidence ≥ threshold (0..255). Default: soft alpha (best for hair)." },
    { name: "fit", type: "string", description: 'Scale and move the layer so the subject fits this canvas box "x,y,width,height"; "none" leaves it in place. Default: the template\'s subject area on its photo slot (first cut-out after `new --template … --image`).' },
    { name: "anchor", type: "string", description: "With --fit: where the subject sits in the box — center (default), bottom (on a floor line), top, left, right, top-left…" },
  ],
  async run({ io, options, positionals }) {
    const id = positional(positionals, 0, "layer id", "remove-bg <layer>");
    const fs = projectFs(options);
    const input: Record<string, unknown> = { id };
    if (strOpt(options, "model")) input.model = strOpt(options, "model");
    if (strOpt(options, "background") !== undefined) input.background = paintValue(strOpt(options, "background"));
    if (boolOpt(options, "shadow")) input.shadow = true;
    if (numOpt(options, "feather") !== undefined) input.feather = numOpt(options, "feather");
    if (numOpt(options, "threshold") !== undefined) input.threshold = numOpt(options, "threshold");
    const fit = strOpt(options, "fit");
    if (fit !== undefined) {
      if (fit === "none" || fit === "false") input.fit = false;
      else {
        const v = fit.split(",").map((x) => Number(x.trim()));
        if (v.length !== 4 || !v.every(Number.isFinite)) usage(`Invalid --fit "${fit}".`, 'Pass the canvas box "x,y,width,height" (e.g. --fit 500,400,1000,850 --anchor bottom) or "none".');
        input.fit = { x: v[0], y: v[1], width: v[2], height: v[3], ...(strOpt(options, "anchor") ? { anchor: strOpt(options, "anchor") } : {}) };
      }
    } else if (strOpt(options, "anchor")) usage("--anchor needs --fit.", "e.g. remove-bg photo --fit 500,400,1000,850 --anchor bottom");
    const r = await tool<MutationResult & { mask: string; model: string; size: string; fitted?: { box: { x: number; y: number; width: number; height: number }; anchor: string } }>(fs, "remove_background", input);
    if (r.status === "refused") throw new CliError("validation", "The cut-out could not be applied.", "See details.issues.", 2, { issues: r.issues });
    printResult(io, { ...r, maskFile: absPath(fs, r.mask) }, () => `Background removed from "${id}" (${r.model}): mask ${r.mask} (${r.size}). ${r.plan.summary}${r.fitted ? `\nSubject fitted into ${r.fitted.box.x},${r.fitted.box.y},${r.fitted.box.width},${r.fitted.box.height} (${r.fitted.anchor}); --fit none keeps the layer in place.` : ""}\nLook at it: agentphoto render --project ${shownDir(fs.root, strOpt(options, "project"))}`);
  },
};

export const analyzeCommand: Command = {
  name: "analyze",
  usage: "analyze [--layer <id>]",
  summary: "Measure the picture (or one layer's own pixels): brightness, contrast, tonal range, clipping, colour cast, saturation, sharpness, dominant colours — with suggested filters ready for `filter add`.",
  options: [PROJECT_OPTION, { name: "layer", type: "string", description: "Analyse this layer alone (default: the whole render)." }],
  async run({ io, options }) {
    const fs = projectFs(options);
    const layer = strOpt(options, "layer");
    const r = await tool<{ width: number; height: number; brightness: number; contrast: number; saturation: number; sharpness: number; clippedShadows: number; clippedHighlights: number; cast: { warm: number; magenta: number }; dominant: { color: string; share: number }[]; suggestions: { issue: string; filter: unknown }[] }>(fs, "image_analyze", layer ? { layer } : {});
    printResult(io, r, () =>
      [
        `${layer ? `Layer "${layer}"` : "Image"} ${r.width}×${r.height}: brightness ${r.brightness}, contrast ${r.contrast}, saturation ${r.saturation}, sharpness ${r.sharpness}`,
        `Clipped: shadows ${r.clippedShadows} %, highlights ${r.clippedHighlights} %  ·  cast warm ${r.cast.warm}, magenta ${r.cast.magenta}`,
        `Dominant: ${r.dominant.map((d) => `${d.color} (${d.share} %)`).join(", ")}`,
        ...(r.suggestions.length ? ["Suggestions:", ...r.suggestions.map((s) => `  ${s.issue}: ${JSON.stringify(s.filter)}`)] : ["No correction suggested."]),
      ].join("\n"),
    );
  },
};

function parseZoom(raw: string): { x: number; y: number; width: number; height: number } {
  const n = raw.split(/[\s,x]+/).filter(Boolean).map(Number);
  if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || n[2] <= 0 || n[3] <= 0) usage(`--zoom must be x,y,width,height (canvas px), got "${raw}".`, "e.g. --zoom 400,200,600,400");
  return { x: n[0], y: n[1], width: n[2], height: n[3] };
}

export const renderCommand: Command = {
  name: "render",
  usage: "render [--max-width <px>] [--compare] [--layer <id>] [--zoom x,y,w,h]",
  summary: "Render the document headless (Chrome) to renders/preview.png and print the image path(s) — LOOK at them after every visual change. --compare also renders the unedited 'before', --layer one layer alone, --zoom a canvas region at 1:1 (mask edges, text).",
  options: [
    PROJECT_OPTION,
    { name: "max-width", type: "string", description: "Preview width cap in px (default 1000)." },
    { name: "compare", type: "boolean", description: "Also render the version without filters / adjustments (before / after)." },
    { name: "layer", type: "string", description: "Render only this layer." },
    { name: "zoom", type: "string", description: "Canvas region x,y,width,height rendered at full resolution (max 1600 px)." },
    { name: "backdrop", type: "string", description: 'Under transparent areas: "checker" (default for transparent canvases and --layer), a CSS colour, or "none".' },
  ],
  async run({ io, options }) {
    const fs = projectFs(options);
    const input: Record<string, unknown> = {};
    if (numOpt(options, "max-width") !== undefined) input.maxWidth = numOpt(options, "max-width");
    if (boolOpt(options, "compare")) input.compare = true;
    if (strOpt(options, "backdrop")) input.backdrop = strOpt(options, "backdrop");
    if (strOpt(options, "layer")) input.layer = strOpt(options, "layer");
    if (strOpt(options, "zoom")) input.zoom = parseZoom(strOpt(options, "zoom")!);
    const r = await tool<{ preview: string; images: string[]; size: string; canvas: string; errors?: unknown[]; hint?: string }>(fs, "render_preview", input);
    const files = r.images.map((p) => absPath(fs, p));
    printResult(io, { ...r, files }, () => [...files, `${r.size} (canvas ${r.canvas})`, ...(r.errors?.length ? [`Errors: ${JSON.stringify(r.errors)}`] : [])].join("\n"));
  },
};

export const exportCommand: Command = {
  name: "export",
  usage: "export [--format png|jpeg|webp|avif] [--quality <1-100>] [--preset <size>] [--width <px>] [--height <px>] [--scale <k>] [--fit cover|contain|stretch] [--background <colour>] [--name <file>] [--out <path>] [--variants <json>] [--yes]",
  summary: "Render the final image(s) into dist/ (headless Chrome): format, quality, size (a preset like og / square / story, or width / height / scale), fit (cover crops, contain pads) and background (flatten transparency). --variants exports several at once. Overwriting existing files needs --yes.",
  writes: true,
  options: [
    PROJECT_OPTION,
    { name: "format", type: "string", description: "png (default), jpeg, webp or avif." },
    { name: "quality", type: "string", description: "1..100 (jpeg 88, webp 86, avif 70 by default)." },
    { name: "preset", type: "string", description: "Size preset (`agentphoto catalog sizes`)." },
    { name: "width", type: "string", description: "Output width in px." },
    { name: "height", type: "string", description: "Output height in px." },
    { name: "scale", type: "string", description: "Output scale (2 = twice the canvas)." },
    { name: "fit", type: "string", description: "cover (crop, default), contain (pad) or stretch — when the output aspect differs." },
    { name: "background", type: "string", description: 'Flatten transparency onto this colour ("transparent" keeps alpha; jpeg defaults to white).' },
    { name: "name", type: "string", description: "File name without extension (default: the document id)." },
    { name: "out", type: "string", description: "Output path inside the project (default dist/<name>[-<preset>].<ext>)." },
    { name: "variants", type: "string", description: 'Several outputs: JSON array of { format, preset, width, height, quality, … } (e.g. \'[{"preset":"og"},{"preset":"story","format":"webp"}]\').' },
    YES_OPTION,
  ],
  async run({ io, options }) {
    const fs = projectFs(options);
    const input: Record<string, unknown> = {};
    for (const k of ["format", "preset", "fit", "name", "out"]) if (strOpt(options, k)) input[k] = strOpt(options, k);
    for (const k of ["quality", "width", "height", "scale"]) if (numOpt(options, k) !== undefined) input[k] = numOpt(options, k);
    const bg = strOpt(options, "background");
    if (bg !== undefined) input.background = paintValue(bg);
    if (input.background !== undefined && input.background !== null && typeof input.background !== "string") usage("--background must be a colour for exports.");
    const variants = jsonOpt(options, "variants", `--variants '[{"preset":"og"},{"preset":"story","format":"webp"}]'`);
    if (variants !== undefined) {
      if (!Array.isArray(variants) || !variants.length || variants.some((v) => !v || typeof v !== "object" || Array.isArray(v))) usage("--variants must be a JSON array of objects.", `e.g. --variants '[{"preset":"og"},{"preset":"square","format":"jpeg"}]'`);
      input.variants = variants;
    }
    // Plan: the files it would write (ops planExport, same merge as the export tool).
    const [{ getDoc }, { planExport }] = await Promise.all([import("../../src/ops/doc"), import("../../src/ops/export")]);
    const doc = await getDoc(fs);
    const { variants: _v, ...base } = input;
    const reqs = Array.isArray(variants) ? (variants as Record<string, unknown>[]).map((v) => ({ ...base, out: undefined, ...v })) : [base];
    const jobs = reqs.map((r) => planExport(doc, r as never));
    const existing: string[] = [];
    for (const j of jobs) if (await fs.exists(j.file)) existing.push(j.file);
    if (existing.length) {
      const plan = { overwrite: existing, files: jobs.map((j) => ({ path: j.file, format: j.format, width: j.width, height: j.height })) };
      if (!confirmOrPlan(io, options, plan, () => `Export would overwrite: ${existing.join(", ")}`)) return;
    }
    log(`Exporting ${jobs.length} file${jobs.length > 1 ? "s" : ""}…`);
    const r = await tool<{ files: { path: string; format: string; width: number; height: number; kb: number; note?: string }[]; hint: string }>(fs, "export", input);
    const files = r.files.map((f) => ({ ...f, file: absPath(fs, f.path) }));
    printResult(io, { ...r, files }, () => files.map((f) => `${f.file}  (${f.format}, ${f.width}×${f.height}, ${f.kb} KB)${f.note ? `  ${f.note}` : ""}`).join("\n"));
  },
};

export const checkCommand: Command = {
  name: "check",
  usage: "check [--project <dir>]",
  summary: "Everything to fix before export: validation, missing files, layers off the canvas, upscaled (blurry) photos, text that may overflow, heavy filters, licences needing attribution. Exit 1 when not ok.",
  options: [PROJECT_OPTION],
  async run({ io, options }) {
    const fs = projectFs(options);
    const r = await tool<{ ok: boolean; issues: { severity: string; code: string; path?: string; message: string; hint?: string }[]; canvas: { width: number; height: number; megapixels: number }; layers: number; cost: number; assetsKb: number; licences: { path: string; license?: string; attribution?: string }[] }>(fs, "check", {});
    printResult(io, r, () =>
      [
        r.ok ? "Check passed." : "Check failed.",
        ...r.issues.map((i) => `  ${i.severity === "error" ? "✗" : i.severity === "warning" ? "!" : "·"} ${i.code} ${i.path ?? ""}: ${i.message}${i.hint ? ` (${i.hint})` : ""}`),
        `Canvas ${r.canvas.width}×${r.canvas.height} (${r.canvas.megapixels} MP), ${r.layers} layers, render cost ${r.cost}, assets ${r.assetsKb} KB`,
        ...(r.licences.length ? ["Licences:", ...r.licences.map((l) => `  ${l.path}: ${l.license ?? "?"}${l.attribution ? ` — ${l.attribution}` : ""}`)] : []),
      ].join("\n"),
    );
    return r.ok ? 0 : 1;
  },
};
