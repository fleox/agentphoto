// The catalog — declared ONCE. Validation (validate.ts), the engine's filter
// registry (src/engine/filters/), the AI tools (catalog_get), the Studio
// (filter / look / effect pickers, inspectors) and docs/catalog.md derive from
// it. A filter or look id without an engine implementation fails the tests.

import { BLEND_MODES } from "./types";

export type ParamType = "number" | "int" | "boolean" | "color" | "enum" | "stops" | "curve" | "rgb";

export interface ParamDef {
  name: string;
  type: ParamType;
  description: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  // Distance-like params scale with the render (preview at 50 % → radius / 2).
  px?: boolean;
}

export interface FilterDef {
  id: string;
  title: string;
  group: "light" | "color" | "tone" | "detail" | "blur" | "stylize" | "auto" | "look";
  description: string;
  params: ParamDef[];
  // Example filter object (shown by catalog_get, used by docs).
  example?: Record<string, unknown>;
  // Relative cost per megapixel (budget hints): 1 = a cheap per-pixel op.
  cost: number;
}

export interface LookDef {
  id: string;
  title: string;
  description: string;
}

export interface EffectDef {
  id: "dropShadow" | "outerGlow" | "innerShadow" | "stroke" | "colorOverlay";
  title: string;
  description: string;
  params: ParamDef[];
}

export interface FontDef {
  id: string;
  family: string;
  weights: number[];
  italic?: number[];
  style: "sans" | "serif" | "display" | "script" | "mono" | "slab";
  description: string;
}

export interface SizePreset {
  id: string;
  title: string;
  width: number;
  height: number;
  description: string;
}

export interface ModelDef {
  id: string;
  task: "background-removal" | "segmentation";
  repo: string;
  sizeMb: number;
  license: string;
  description: string;
}

// ─── param helpers ───────────────────────────────────────────────────────

const n = (name: string, description: string, def: number, min: number, max: number, extra: Partial<ParamDef> = {}): ParamDef => ({ name, type: "number", description, default: def, min, max, ...extra });
const i = (name: string, description: string, def: number, min: number, max: number, extra: Partial<ParamDef> = {}): ParamDef => ({ name, type: "int", description, default: def, min, max, step: 1, ...extra });
const b = (name: string, description: string, def: boolean): ParamDef => ({ name, type: "boolean", description, default: def });
const c = (name: string, description: string, def: string): ParamDef => ({ name, type: "color", description, default: def });
const e = (name: string, description: string, def: string, options: readonly string[]): ParamDef => ({ name, type: "enum", description, default: def, options });
const rgb = (name: string, description: string): ParamDef => ({ name, type: "rgb", description, default: [0, 0, 0], min: -100, max: 100 });

// ─── filters ─────────────────────────────────────────────────────────────

export const LOOKS: LookDef[] = [
  { id: "bw", title: "B&W", description: "Neutral black & white." },
  { id: "noir", title: "Noir", description: "Contrasty black & white with a dark vignette." },
  { id: "sepia", title: "Sepia", description: "Warm brown monochrome, old print." },
  { id: "vintage", title: "Vintage", description: "Faded warm colours, soft contrast, light vignette." },
  { id: "polaroid", title: "Polaroid", description: "Warm, slightly washed instant-film look." },
  { id: "lomo", title: "Lomo", description: "Saturated, contrasty, strong vignette." },
  { id: "warm", title: "Warm", description: "Golden warm cast." },
  { id: "cool", title: "Cool", description: "Blue cool cast." },
  { id: "sunset", title: "Sunset", description: "Orange-pink evening glow." },
  { id: "fade", title: "Fade", description: "Lifted blacks, matte pastel finish." },
  { id: "punch", title: "Punch", description: "Vivid colours and extra contrast." },
  { id: "cinema", title: "Cinema", description: "Teal shadows, orange highlights (blockbuster grade)." },
  { id: "cyberpunk", title: "Cyberpunk", description: "Magenta / cyan neon grade." },
  { id: "cross-process", title: "Cross process", description: "Green shadows, warm highlights (XPro film)." },
  { id: "dramatic", title: "Dramatic", description: "Desaturated, hard contrast, dark edges." },
  { id: "dreamy", title: "Dreamy", description: "Soft, airy, pastel lift." },
  { id: "matte", title: "Matte", description: "Flat matte finish with lifted shadows and gentle colours." },
  { id: "golden-hour", title: "Golden hour", description: "Late-afternoon warmth with soft highlights." },
  { id: "film", title: "Film", description: "Subtle film emulation: soft contrast, warm mids, fine grain." },
  { id: "clean", title: "Clean", description: "Bright, crisp, slightly cool — product / e-commerce." },
];

export const FILTERS: FilterDef[] = [
  // light
  {
    id: "brightnessContrast",
    title: "Brightness / Contrast",
    group: "light",
    description: "Lighten or darken the image and increase or reduce contrast.",
    params: [n("brightness", "-100 (darker) … 100 (lighter).", 0, -100, 100), n("contrast", "-100 (flat) … 100 (punchy).", 0, -100, 100)],
    example: { type: "brightnessContrast", brightness: 10, contrast: 15 },
    cost: 1,
  },
  {
    id: "exposure",
    title: "Exposure",
    group: "light",
    description: "Photographic exposure in stops (linear light), with offset and gamma.",
    params: [n("exposure", "Stops: +1 doubles the light.", 0, -5, 5, { step: 0.05 }), n("offset", "Lifts (+) or crushes (−) the blacks.", 0, -0.5, 0.5, { step: 0.01 }), n("gamma", "Midtone gamma (1 = unchanged).", 1, 0.1, 5, { step: 0.01 })],
    example: { type: "exposure", exposure: 0.5 },
    cost: 1,
  },
  {
    id: "shadowsHighlights",
    title: "Shadows / Highlights",
    group: "light",
    description: "Open up dark areas and recover bright ones, using local luminance (backlit portraits, skies).",
    params: [n("shadows", "How much to lighten the shadows.", 35, 0, 100), n("highlights", "How much to darken the highlights.", 0, 0, 100), n("radius", "Neighbourhood size, px.", 30, 1, 200, { px: true })],
    example: { type: "shadowsHighlights", shadows: 40, highlights: 20 },
    cost: 4,
  },
  {
    id: "levels",
    title: "Levels",
    group: "tone",
    description: "Input black / white points and midtone gamma, output range.",
    params: [n("black", "Input black point.", 0, 0, 254), n("white", "Input white point.", 255, 1, 255), n("gamma", "Midtones (>1 lighter).", 1, 0.1, 9.99, { step: 0.01 }), n("outBlack", "Output black.", 0, 0, 255), n("outWhite", "Output white.", 255, 0, 255)],
    example: { type: "levels", black: 12, white: 240, gamma: 1.1 },
    cost: 1,
  },
  {
    id: "curves",
    title: "Curves",
    group: "tone",
    description: "Tone curves through control points [input, output] (0..255), smooth (monotone cubic). `rgb` affects all channels; `red` / `green` / `blue` affect one.",
    params: [
      { name: "rgb", type: "curve", description: "Master curve points, e.g. [[0,0],[64,50],[192,210],[255,255]] (an S-curve).", default: [[0, 0], [255, 255]] },
      { name: "red", type: "curve", description: "Red channel curve (optional)." },
      { name: "green", type: "curve", description: "Green channel curve (optional)." },
      { name: "blue", type: "curve", description: "Blue channel curve (optional)." },
    ],
    example: { type: "curves", rgb: [[0, 0], [64, 52], [192, 206], [255, 255]] },
    cost: 1,
  },
  // color
  {
    id: "hueSaturation",
    title: "Hue / Saturation",
    group: "color",
    description: "Rotate hues, change saturation and lightness. `colorize` tints the whole image with one hue.",
    params: [n("hue", "Hue rotation, degrees.", 0, -180, 180), n("saturation", "-100 (grey) … 100.", 0, -100, 100), n("lightness", "-100 … 100.", 0, -100, 100), b("colorize", "Tint everything with `hue` (0..360 then) at `saturation`.", false)],
    example: { type: "hueSaturation", saturation: 20 },
    cost: 2,
  },
  {
    id: "vibrance",
    title: "Vibrance",
    group: "color",
    description: "Boost muted colours more than saturated ones (skin-safe saturation).",
    params: [n("vibrance", "-100 … 100.", 30, -100, 100), n("saturation", "Plain saturation on top, -100 … 100.", 0, -100, 100)],
    example: { type: "vibrance", vibrance: 30 },
    cost: 1,
  },
  {
    id: "temperature",
    title: "White balance",
    group: "color",
    description: "Colour temperature (blue ↔ yellow) and tint (green ↔ magenta). Fixes colour casts.",
    params: [n("temperature", "-100 (cooler) … 100 (warmer).", 0, -100, 100), n("tint", "-100 (green) … 100 (magenta).", 0, -100, 100)],
    example: { type: "temperature", temperature: 15 },
    cost: 1,
  },
  {
    id: "colorBalance",
    title: "Color balance",
    group: "color",
    description: "Shift shadows, midtones and highlights towards cyan/red, magenta/green, yellow/blue: [r, g, b] each -100..100.",
    params: [rgb("shadows", "[cyan↔red, magenta↔green, yellow↔blue] for the shadows."), rgb("midtones", "Same for the midtones."), rgb("highlights", "Same for the highlights."), b("preserveLuminosity", "Keep the brightness unchanged.", true)],
    example: { type: "colorBalance", shadows: [-10, 0, 10], highlights: [10, 0, -10] },
    cost: 1,
  },
  {
    id: "photoFilter",
    title: "Photo filter",
    group: "color",
    description: "Warming / cooling / coloured lens filter.",
    params: [c("color", "Filter colour (warming #ec8a00, cooling #006dff…).", "#ec8a00"), n("density", "Strength, 0 … 100.", 25, 0, 100), b("preserveLuminosity", "Keep the brightness unchanged.", true)],
    example: { type: "photoFilter", color: "#ec8a00", density: 25 },
    cost: 1,
  },
  {
    id: "gradientMap",
    title: "Gradient map",
    group: "color",
    description: "Map luminance to a gradient (duotones, tritones): shadows take the first stop, highlights the last.",
    params: [{ name: "stops", type: "stops", description: 'Colours dark → light: ["#1b1340", "#ff7a59"] or [[0,"#000"],[1,"#fff"]].', default: ["#000000", "#ffffff"] }],
    example: { type: "gradientMap", stops: ["#1b1340", "#ff7a59", "#fff3d6"] },
    cost: 1,
  },
  {
    id: "grayscale",
    title: "Black & white",
    group: "color",
    description: "Convert to grey with adjustable channel weights (red / green / blue contributions, %).",
    params: [n("red", "Red contribution.", 30, -200, 300), n("green", "Green contribution.", 59, -200, 300), n("blue", "Blue contribution.", 11, -200, 300)],
    example: { type: "grayscale" },
    cost: 1,
  },
  {
    id: "sepia",
    title: "Sepia",
    group: "color",
    description: "Brown monochrome tone.",
    params: [n("intensity", "0 … 100.", 100, 0, 100)],
    example: { type: "sepia", intensity: 80 },
    cost: 1,
  },
  {
    id: "invert",
    title: "Invert",
    group: "color",
    description: "Negative image.",
    params: [],
    example: { type: "invert" },
    cost: 1,
  },
  {
    id: "threshold",
    title: "Threshold",
    group: "stylize",
    description: "Pure black & white at a luminance level.",
    params: [n("level", "0 … 255.", 128, 0, 255)],
    example: { type: "threshold", level: 128 },
    cost: 1,
  },
  {
    id: "posterize",
    title: "Posterize",
    group: "stylize",
    description: "Reduce the number of tones per channel.",
    params: [i("levels", "Tones per channel.", 6, 2, 32)],
    example: { type: "posterize", levels: 5 },
    cost: 1,
  },
  // detail / blur
  {
    id: "blur",
    title: "Gaussian blur",
    group: "blur",
    description: "Soft blur (backgrounds, depth of field when masked, privacy).",
    params: [n("radius", "Radius, px.", 6, 0, 250, { px: true })],
    example: { type: "blur", radius: 12 },
    cost: 3,
  },
  {
    id: "motionBlur",
    title: "Motion blur",
    group: "blur",
    description: "Directional blur (speed, panning).",
    params: [n("angle", "Direction, degrees.", 0, -180, 180), n("distance", "Length, px.", 20, 0, 400, { px: true })],
    example: { type: "motionBlur", angle: 0, distance: 30 },
    cost: 6,
  },
  {
    id: "surfaceBlur",
    title: "Surface blur",
    group: "blur",
    description: "Edge-preserving smoothing (skin retouch, noise): flattens texture while keeping edges sharp. Usually masked to the area to smooth.",
    params: [n("radius", "Neighbourhood, px.", 8, 1, 60, { px: true }), n("threshold", "Edge sensitivity, 1 (only flat areas) … 100 (smooth everything).", 25, 1, 100)],
    example: { type: "surfaceBlur", radius: 8, threshold: 25 },
    cost: 6,
  },
  {
    id: "sharpen",
    title: "Sharpen",
    group: "detail",
    description: "Unsharp mask: amount %, radius px, threshold (skip low-contrast detail such as skin / noise).",
    params: [n("amount", "Strength, %.", 80, 0, 500), n("radius", "Px.", 1.2, 0.3, 20, { px: true, step: 0.1 }), n("threshold", "0 … 255.", 2, 0, 255)],
    example: { type: "sharpen", amount: 80, radius: 1.2 },
    cost: 3,
  },
  {
    id: "clarity",
    title: "Clarity",
    group: "detail",
    description: "Local midtone contrast (texture, punch) — negative values soften.",
    params: [n("amount", "-100 … 100.", 30, -100, 100), n("radius", "Px.", 24, 2, 200, { px: true })],
    example: { type: "clarity", amount: 25 },
    cost: 4,
  },
  {
    id: "noise",
    title: "Grain / noise",
    group: "stylize",
    description: "Film grain (deterministic: same seed, same grain).",
    params: [n("amount", "0 … 100.", 12, 0, 100), b("monochrome", "Grey grain instead of colour.", true), i("seed", "Random seed.", 1, 0, 999999), n("size", "Grain size, px.", 1, 1, 8, { px: true, step: 0.5 })],
    example: { type: "noise", amount: 10 },
    cost: 1,
  },
  {
    id: "pixelate",
    title: "Pixelate",
    group: "stylize",
    description: "Big square pixels (mosaic, anonymise a face when masked).",
    params: [n("size", "Cell size, px.", 16, 2, 400, { px: true })],
    example: { type: "pixelate", size: 20 },
    cost: 1,
  },
  {
    id: "vignette",
    title: "Vignette",
    group: "stylize",
    description: "Darken (or lighten, negative amount) the edges to draw the eye to the centre.",
    params: [n("amount", "-100 (white) … 100 (dark).", 40, -100, 100), n("size", "Clear centre size, 0 … 100.", 50, 0, 100), n("feather", "Softness, 0 … 100.", 60, 0, 100), c("color", "Edge colour.", "#000000")],
    example: { type: "vignette", amount: 40 },
    cost: 1,
  },
  // auto
  {
    id: "autoTone",
    title: "Auto tone",
    group: "auto",
    description: "Stretch each channel's range (clips 0.5 % at each end) — fixes dull / hazy photos and colour casts.",
    params: [n("clip", "Percent clipped at each end.", 0.5, 0, 5, { step: 0.1 })],
    example: { type: "autoTone" },
    cost: 1,
  },
  {
    id: "autoContrast",
    title: "Auto contrast",
    group: "auto",
    description: "Stretch the luminance range without changing colours.",
    params: [n("clip", "Percent clipped at each end.", 0.5, 0, 5, { step: 0.1 })],
    example: { type: "autoContrast" },
    cost: 1,
  },
  {
    id: "autoColor",
    title: "Auto color",
    group: "auto",
    description: "Neutralise the colour cast (grey-world white balance) and stretch contrast.",
    params: [],
    example: { type: "autoColor" },
    cost: 1,
  },
  // looks
  {
    id: "look",
    title: "Look",
    group: "look",
    description: "One-click photo grade (Instagram-style preset). Use `amount` (0..1) to dial it in.",
    params: [e("look", "Look id.", "vintage", LOOKS.map((l) => l.id))],
    example: { type: "look", look: "cinema", amount: 0.7 },
    cost: 2,
  },
];

// Params every filter accepts (not listed per filter).
export const COMMON_FILTER_PARAMS: ParamDef[] = [b("enabled", "false = keep the filter but skip it.", true), n("amount", "Blend with the unfiltered pixels, 0 … 1.", 1, 0, 1, { step: 0.01 })];

// ─── layer effects ───────────────────────────────────────────────────────

export const EFFECTS: EffectDef[] = [
  {
    id: "dropShadow",
    title: "Drop shadow",
    description: "Shadow cast by the layer's shape (cut-outs, text, stickers).",
    params: [c("color", "Shadow colour.", "#000000"), n("opacity", "0 … 1.", 0.5, 0, 1, { step: 0.01 }), n("angle", "Light angle, degrees (135 = shadow down-right).", 135, -180, 180), n("distance", "Offset, px.", 12, 0, 500, { px: true }), n("blur", "Softness, px.", 16, 0, 250, { px: true }), n("spread", "Grow before blurring, px.", 0, 0, 100, { px: true })],
  },
  {
    id: "outerGlow",
    title: "Outer glow",
    description: "Soft halo around the layer (neon, separation from the background).",
    params: [c("color", "Glow colour.", "#ffffff"), n("opacity", "0 … 1.", 0.6, 0, 1, { step: 0.01 }), n("blur", "Size, px.", 20, 0, 250, { px: true }), n("spread", "Grow before blurring, px.", 0, 0, 100, { px: true })],
  },
  {
    id: "innerShadow",
    title: "Inner shadow",
    description: "Shadow inside the layer's edges (inset, pressed look).",
    params: [c("color", "Shadow colour.", "#000000"), n("opacity", "0 … 1.", 0.5, 0, 1, { step: 0.01 }), n("angle", "Light angle, degrees.", 135, -180, 180), n("distance", "Offset, px.", 6, 0, 200, { px: true }), n("blur", "Softness, px.", 10, 0, 200, { px: true })],
  },
  {
    id: "stroke",
    title: "Stroke",
    description: "Outline around the layer's shape (sticker outline, text outline).",
    params: [c("color", "Outline colour.", "#ffffff"), n("width", "Px.", 6, 0, 200, { px: true }), e("position", "Where the outline sits.", "outside", ["outside", "center", "inside"]), n("opacity", "0 … 1.", 1, 0, 1, { step: 0.01 })],
  },
  {
    id: "colorOverlay",
    title: "Color overlay",
    description: "Fill the layer's shape with a colour (recolour icons / silhouettes).",
    params: [c("color", "Colour.", "#ffffff"), n("opacity", "0 … 1.", 1, 0, 1, { step: 0.01 }), e("blend", "Blend mode of the overlay.", "normal", BLEND_MODES)],
  },
];

// ─── fonts (files in library/fonts, see library/index.json) ──────────────

export const FONTS: FontDef[] = [
  { id: "inter", family: "Inter", weights: [400, 600, 700, 800], style: "sans", description: "Neutral modern sans — UI, body text, clean headlines." },
  { id: "montserrat", family: "Montserrat", weights: [400, 700, 800], style: "sans", description: "Geometric sans — bold marketing headlines." },
  { id: "poppins", family: "Poppins", weights: [400, 600, 700], style: "sans", description: "Friendly geometric sans — social posts, thumbnails." },
  { id: "space-grotesk", family: "Space Grotesk", weights: [500, 700], style: "sans", description: "Techy grotesk — startups, tech." },
  { id: "playfair", family: "Playfair Display", weights: [400, 700], italic: [400], style: "serif", description: "Elegant high-contrast serif — luxury, editorial, quotes." },
  { id: "dm-serif", family: "DM Serif Display", weights: [400], style: "serif", description: "Display serif — magazine covers, titles." },
  { id: "roboto-slab", family: "Roboto Slab", weights: [400, 700], style: "slab", description: "Sturdy slab serif — posters, labels." },
  { id: "bebas-neue", family: "Bebas Neue", weights: [400], style: "display", description: "Tall all-caps condensed — YouTube thumbnails, posters, sports." },
  { id: "anton", family: "Anton", weights: [400], style: "display", description: "Heavy condensed — impact headlines." },
  { id: "oswald", family: "Oswald", weights: [400, 600], style: "display", description: "Condensed gothic — banners, sale tags." },
  { id: "archivo-black", family: "Archivo Black", weights: [400], style: "display", description: "Very bold grotesk — loud short words." },
  { id: "lobster", family: "Lobster", weights: [400], style: "script", description: "Retro bold script — food, vintage, fun." },
  { id: "pacifico", family: "Pacifico", weights: [400], style: "script", description: "Surf brush script — casual, summer." },
  { id: "caveat", family: "Caveat", weights: [400, 700], style: "script", description: "Handwriting — notes, annotations, personal touch." },
  { id: "jetbrains-mono", family: "JetBrains Mono", weights: [400, 700], style: "mono", description: "Monospace — code, tech labels." },
];

// ─── sizes ───────────────────────────────────────────────────────────────

export const SIZE_PRESETS: SizePreset[] = [
  { id: "og", title: "Open Graph / link preview", width: 1200, height: 630, description: "Facebook, LinkedIn, Slack, iMessage link cards." },
  { id: "square", title: "Square post", width: 1080, height: 1080, description: "Instagram / Facebook feed." },
  { id: "portrait", title: "Portrait post", width: 1080, height: 1350, description: "Instagram 4:5 feed." },
  { id: "story", title: "Story / Reel / TikTok", width: 1080, height: 1920, description: "9:16 vertical." },
  { id: "landscape", title: "Full HD", width: 1920, height: 1080, description: "16:9 slides, hero images, wallpapers." },
  { id: "youtube", title: "YouTube thumbnail", width: 1280, height: 720, description: "16:9 video thumbnail." },
  { id: "twitter", title: "X / Twitter post", width: 1600, height: 900, description: "16:9 in-feed image." },
  { id: "pinterest", title: "Pinterest pin", width: 1000, height: 1500, description: "2:3 pin." },
  { id: "banner", title: "Web banner", width: 1920, height: 600, description: "Wide hero / header banner." },
  { id: "linkedin-banner", title: "LinkedIn banner", width: 1584, height: 396, description: "Profile cover." },
  { id: "avatar", title: "Avatar", width: 800, height: 800, description: "Profile picture (often shown round)." },
  { id: "product", title: "Product shot", width: 2000, height: 2000, description: "E-commerce square on white." },
  { id: "a4", title: "A4 portrait (150 dpi)", width: 1240, height: 1754, description: "Flyer / print at 150 dpi." },
];

// ─── AI models (downloaded once on first use, cached on this computer) ───

export const MODELS: ModelDef[] = [
  { id: "rmbg-1.4", task: "background-removal", repo: "briaai/RMBG-1.4", sizeMb: 168, license: "bria-rmbg-1.4 (non-commercial)", description: "General background removal — products, people, animals, objects. Best default." },
  { id: "modnet", task: "background-removal", repo: "Xenova/modnet", sizeMb: 25, license: "Apache-2.0", description: "Portrait matting — people only, soft hair edges." },
  { id: "slimsam", task: "segmentation", repo: "Xenova/slimsam-77-uniform", sizeMb: 30, license: "Apache-2.0", description: "Segment Anything (light): select an object from points or a box." },
  { id: "sam-base", task: "segmentation", repo: "Xenova/sam-vit-base", sizeMb: 100, license: "Apache-2.0", description: "Segment Anything (base): more precise selections, slower." },
];

export const DEFAULT_MODELS = { "background-removal": "rmbg-1.4", segmentation: "slimsam" } as const;

// ─── the whole catalog (catalog_get, GET /api/catalog, docs) ─────────────

export const LAYER_TYPES = [
  { id: "image", description: "A photo / bitmap from the project (assets/…) or the library (library:<id>), placed in a box (x, y, width, height, rotation, flip), optionally cropped (crop) and fitted (fit: fill | cover | contain)." },
  { id: "text", description: "Live text: text, font (catalog id), size, weight, italic, color (colour or gradient), align, valign, lineHeight, letterSpacing, transform, width (wrap), background (label box)." },
  { id: "shape", description: "Vector shape: shape rect | ellipse | line | polygon | star, fill (colour or gradient, null = none), stroke {color, width, dash}, radius, sides, innerRadius." },
  { id: "fill", description: "Solid colour or gradient covering the canvas (backgrounds, colour washes; use a mask to shape it)." },
  { id: "adjustment", description: "Applies its filters to everything below it (inside its group) — non-destructive global corrections." },
  { id: "group", description: "Groups layers (children, bottom → top): opacity, blend, mask and filters apply to the group as a whole." },
] as const;

export const SHAPES = ["rect", "ellipse", "line", "polygon", "star"] as const;

export const CATALOG = {
  layerTypes: LAYER_TYPES,
  blendModes: BLEND_MODES,
  filters: FILTERS,
  commonFilterParams: COMMON_FILTER_PARAMS,
  looks: LOOKS,
  effects: EFFECTS,
  shapes: SHAPES,
  fonts: FONTS,
  sizes: SIZE_PRESETS,
  models: MODELS,
};

export type CatalogSection = keyof typeof CATALOG;

export const filterDef = (id: string): FilterDef | undefined => FILTERS.find((f) => f.id === id);
export const effectDef = (id: string): EffectDef | undefined => EFFECTS.find((f) => f.id === id);
export const fontDef = (id: string): FontDef | undefined => FONTS.find((f) => f.id === id);
export const sizePreset = (id: string): SizePreset | undefined => SIZE_PRESETS.find((s) => s.id === id);
export const modelDef = (id: string): ModelDef | undefined => MODELS.find((m) => m.id === id);
