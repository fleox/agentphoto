// THE format: a photo document (photo.json) is a non-destructive layer stack
// described as JSON. Sources (photos, masks, painted edits) are files in the
// project; everything else — position, size, rotation, opacity, blend modes,
// masks, filters, looks, layer effects, text, shapes — is data that the
// engine (src/engine/) composites deterministically.
//
// Coordinates are canvas pixels, origin top-left, y down. Angles are degrees
// (clockwise). Colours are CSS strings. Layers are listed bottom → top.
//
// Additive changes only (CLAUDE.md): a breaking change bumps DOC_VERSION and
// needs a migration in normalizeDoc (src/core/validate.ts).

export const DOC_VERSION = 1;

export type Severity = "error" | "warning" | "info";

export interface Issue {
  severity: Severity;
  code: string;
  // JSON path inside the document ("layers#title.size"), or a file path.
  path: string;
  message: string;
  hint?: string;
}

export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

// A colour stop: [offset 0..1, CSS colour]. A bare colour list is spread evenly.
export type ColorStop = [number, string];

export interface LinearGradient {
  type: "linear";
  stops: (ColorStop | string)[];
  // Direction in degrees: 0 = left → right, 90 = top → bottom.
  angle?: number;
}

export interface RadialGradient {
  type: "radial";
  stops: (ColorStop | string)[];
  // Centre and radius as fractions of the painted box (0..1; radius 1 reaches
  // the corners). Elliptical on non-square boxes (half-axes w/√2 and h/√2 ×
  // radius), a circle on square ones. Default: centred, radius 1.
  cx?: number;
  cy?: number;
  radius?: number;
}

export type Gradient = LinearGradient | RadialGradient;

// A CSS colour or a gradient.
export type Paint = string | Gradient;

// A filter (adjustment) from the catalog: { type, ...params }. Applied in
// order, non-destructively, to the layer's pixels (or, for an adjustment
// layer, to everything below it).
export interface Filter {
  type: string;
  // false = kept but skipped (the Studio's eye toggle).
  enabled?: boolean;
  // 0..1 — blends the filtered pixels with the unfiltered ones (default 1).
  amount?: number;
  [param: string]: unknown;
}

// Masks hide parts of a layer: white (or opaque) = visible, black (or
// transparent) = hidden. Coordinates are layer-local for layers with a box
// (image, text, shape: the mask is stretched over the layer and moves with it)
// and canvas coordinates for fill / adjustment / group layers.
export interface MaskBase {
  invert?: boolean;
  // Blur radius of the mask edge, px.
  feather?: number;
  // 0..1: how much the mask hides (1 = fully, 0.5 = hidden parts half visible).
  density?: number;
  // false = the mask is kept but ignored.
  enabled?: boolean;
}

export interface ImageMask extends MaskBase {
  // Project path of a PNG (luminance × alpha) — e.g. written by remove_background.
  src: string;
}

export interface ShapeMask extends MaskBase {
  shape: "rect" | "ellipse";
  x: number;
  y: number;
  width: number;
  height: number;
  // Rect corner radius, px.
  radius?: number;
}

export interface GradientMask extends MaskBase {
  // Gradient whose luminance × alpha is the mask (e.g. a fade to transparent:
  // { type: "linear", angle: 90, stops: ["white", "black"] }).
  gradient: Gradient;
}

export type Mask = ImageMask | ShapeMask | GradientMask;

// Layer styles, drawn from the layer's alpha after filters and mask.
export interface DropShadow {
  color?: string;
  opacity?: number; // 0..1, default 0.5
  angle?: number; // light direction in degrees, default 135 (shadow down-right)
  distance?: number; // px, default 12
  blur?: number; // px, default 16
  spread?: number; // px grown before the blur, default 0
}
export interface Glow {
  color?: string;
  opacity?: number;
  blur?: number;
  spread?: number;
}
export interface Stroke {
  color?: string;
  width?: number; // px, default 4
  position?: "outside" | "center" | "inside";
  opacity?: number;
}
export interface ColorOverlay {
  color: string;
  opacity?: number;
  blend?: BlendMode;
}
export interface LayerEffects {
  dropShadow?: DropShadow | null;
  outerGlow?: Glow | null;
  innerShadow?: DropShadow | null;
  stroke?: Stroke | null;
  colorOverlay?: ColorOverlay | null;
}

export type LayerType = "image" | "text" | "shape" | "fill" | "adjustment" | "group";

export interface LayerBase {
  id: string;
  type: LayerType;
  name?: string;
  // false = hidden (not rendered, not exported).
  visible?: boolean;
  // Studio only: not selectable / movable by hand.
  locked?: boolean;
  opacity?: number; // 0..1, default 1
  blend?: BlendMode; // default "normal"
  mask?: Mask | null;
  // Clipping mask: only draw where the layer directly below is opaque.
  clip?: boolean;
  filters?: Filter[];
  effects?: LayerEffects;
}

// Placement of layers that have a box (image, text, shape).
export interface Placement {
  x?: number; // left edge, px (default 0)
  y?: number; // top edge, px (default 0)
  width?: number; // px (image: natural width when omitted)
  height?: number;
  rotation?: number; // degrees around the box centre
  flipX?: boolean;
  flipY?: boolean;
}

export interface ImageLayer extends LayerBase, Placement {
  type: "image";
  // Project path ("assets/photo.jpg") or a built-in image ("library:portrait").
  src: string;
  // Source rectangle (source pixels) — crops the image before placing it.
  crop?: { x: number; y: number; width: number; height: number };
  // How the (cropped) image fills the box: fill = stretch (default),
  // cover = fill and crop the overflow, contain = fit inside.
  fit?: "fill" | "cover" | "contain";
  // cover / contain alignment, 0..1 (default 0.5, 0.5).
  focus?: [number, number];
}

export interface TextLayer extends LayerBase, Placement {
  type: "text";
  text: string;
  // Catalog font id ("inter", "playfair"…) or a CSS font family.
  font?: string;
  size?: number; // px, default 64
  weight?: number; // 100..900, default 400
  italic?: boolean;
  color?: Paint; // default "#ffffff"
  align?: "left" | "center" | "right";
  // Vertical alignment inside an explicit height.
  valign?: "top" | "middle" | "bottom";
  lineHeight?: number; // multiplier of size, default 1.2
  letterSpacing?: number; // px, default 0
  transform?: "none" | "uppercase" | "lowercase";
  // A box behind the text (label / badge look).
  background?: { color: string; padding?: number | [number, number]; radius?: number } | null;
}

export interface ShapeLayer extends LayerBase, Placement {
  type: "shape";
  shape: "rect" | "ellipse" | "line" | "polygon" | "star";
  fill?: Paint | null;
  stroke?: { color: string; width?: number; dash?: number[] } | null;
  radius?: number; // rect corner radius
  sides?: number; // polygon / star points (default 6 / 5)
  innerRadius?: number; // star: inner radius as a fraction (default 0.5)
}

export interface FillLayer extends LayerBase {
  type: "fill";
  // Covers the whole canvas (use a mask to shape it).
  fill: Paint;
}

export interface AdjustmentLayer extends LayerBase {
  type: "adjustment";
  // The filters applied to everything below (inside the same group).
  filters: Filter[];
}

export interface GroupLayer extends LayerBase {
  type: "group";
  children: Layer[];
}

export type Layer = ImageLayer | TextLayer | ShapeLayer | FillLayer | AdjustmentLayer | GroupLayer;

export interface CanvasDef {
  width: number;
  height: number;
  // null / omitted = transparent.
  background?: Paint | null;
}

export interface PhotoDoc {
  version: number;
  id: string;
  title?: string;
  // Alt text used by exports (snippet, metadata).
  description?: string;
  canvas: CanvasDef;
  layers: Layer[];
  // Default export settings (agentphoto export uses them unless overridden).
  export?: ExportSettings;
}

export type ImageFormat = "png" | "jpeg" | "webp" | "avif";

export interface ExportSettings {
  format?: ImageFormat;
  quality?: number; // 0..100 (jpeg / webp / avif)
  // Output size: scale factor, or a target width / height (aspect kept unless both).
  scale?: number;
  width?: number;
  height?: number;
  // Flatten transparency onto this colour (jpeg always flattens, default white).
  background?: string | null;
  name?: string;
}

// agentphoto.json
export interface ProjectManifest {
  name: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  template?: string;
  // Engine version that last wrote the project.
  agentphoto: string;
}

// assets/manifest.json
export type AssetKind = "image" | "mask" | "edit" | "font" | "other";

export interface AssetEntry {
  path: string;
  kind: AssetKind;
  // Where it came from: "user", "library", "remove_background", "studio", a URL host…
  source: string;
  license?: string;
  author?: string;
  sourceUrl?: string;
  attribution?: string;
  width?: number;
  height?: number;
  bytes?: number;
  addedAt?: string;
}

export interface AssetManifest {
  assets: AssetEntry[];
}

// ─── type guards ─────────────────────────────────────────────────────────

export const hasBox = (l: Layer): l is ImageLayer | TextLayer | ShapeLayer => l.type === "image" || l.type === "text" || l.type === "shape";
export const isImageMask = (m: Mask): m is ImageMask => typeof (m as ImageMask).src === "string";
export const isShapeMask = (m: Mask): m is ShapeMask => typeof (m as ShapeMask).shape === "string";
export const isGradientMask = (m: Mask): m is GradientMask => !!(m as GradientMask).gradient;
