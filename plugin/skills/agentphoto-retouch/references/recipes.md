# Recipes: complete documents

Each document below passed `doc validate` with no warning, `check` with no issue, and was rendered and looked at. They use the built-in sample photos (`library:<id>`) so they render anywhere; for the user's photo, replace `src` with the project path (`assets/images/<file>`) and the canvas / layer size with the photo's size (`info` shows it).

Apply one to a project (replaces the whole document: `--dry-run` first, `--yes` after the user agreed if it removes layers), then render:

```bash
npx -y @fleox/agentphoto@0.1.2 doc apply --file recipe.json --dry-run --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 doc apply --file recipe.json --yes --project my-photo --json
npx -y @fleox/agentphoto@0.1.2 render --project my-photo --compare --json
```

On an existing project, prefer adding the same layers and filters with `layer add` / `filter add` / `doc patch`: the user's other layers stay.

## 1. Colour correction (flat, dull photo)

Levels set the black and white points from `analyze` `range`, a gentle S-curve adds midtone contrast, a slight warm shift and vibrance bring the food back. Sharpening stays on the photo layer (detail filters belong to the pixels, not to the grade).

```json
{
  "version": 1,
  "id": "burger",
  "title": "Colour-corrected food photo",
  "canvas": { "width": 1600, "height": 1067 },
  "layers": [
    { "id": "photo", "type": "image", "src": "library:food", "x": 0, "y": 0, "width": 1600, "height": 1067,
      "filters": [{ "type": "sharpen", "amount": 60, "radius": 1, "threshold": 4 }] },
    { "id": "correct", "type": "adjustment", "name": "Colour correction", "filters": [
      { "type": "levels", "black": 28, "white": 235, "gamma": 1.05 },
      { "type": "curves", "rgb": [[0, 0], [64, 54], [192, 204], [255, 255]] },
      { "type": "temperature", "temperature": 10 },
      { "type": "vibrance", "vibrance": 20 }
    ] }
  ]
}
```

## 2. Portrait retouch

`skin` is a copy of the photo masked to the skin (`mask generate photo --method points --target copy --copy-id skin`, which writes `assets/masks/skin-points.png`), smoothed with an edge-preserving `surfaceBlur` at 70 %. The `grade` adjustment layer opens the shadows, warms slightly, adds a little clarity and vibrance; a soft vignette keeps the eye on the face. Zoom on the face at 1:1 (`render --zoom`) before showing the user.

```json
{
  "version": 1,
  "id": "portrait",
  "title": "Portrait retouch",
  "canvas": { "width": 1600, "height": 1068 },
  "layers": [
    { "id": "photo", "type": "image", "src": "library:portrait", "x": 0, "y": 0, "width": 1600, "height": 1068 },
    { "id": "skin", "type": "image", "name": "Skin (smoothed copy)", "src": "library:portrait", "x": 0, "y": 0, "width": 1600, "height": 1068,
      "mask": { "src": "assets/masks/skin-points.png" },
      "filters": [{ "type": "surfaceBlur", "radius": 10, "threshold": 20, "amount": 0.7 }] },
    { "id": "grade", "type": "adjustment", "name": "Light and colour", "filters": [
      { "type": "shadowsHighlights", "shadows": 30, "highlights": 25 },
      { "type": "temperature", "temperature": 6 },
      { "type": "clarity", "amount": 12 },
      { "type": "vibrance", "vibrance": 18 }
    ] },
    { "id": "vignette", "type": "adjustment", "filters": [{ "type": "vignette", "amount": 25, "size": 60 }] }
  ]
}
```

## 3. Black and white with grain

The `grayscale` channel weights decide which colours become light (more red = brighter skin and brick, less blue = darker sky); the curve deepens blacks without clipping, monochrome `noise` adds film grain, the vignette closes the frame.

```json
{
  "version": 1,
  "id": "street-bw",
  "title": "Black and white street photo",
  "canvas": { "width": 1600, "height": 1067 },
  "layers": [
    { "id": "photo", "type": "image", "src": "library:city", "x": 0, "y": 0, "width": 1600, "height": 1067 },
    { "id": "bw", "type": "adjustment", "name": "B&W", "filters": [
      { "type": "grayscale", "red": 40, "green": 45, "blue": 15 },
      { "type": "curves", "rgb": [[0, 8], [70, 58], [190, 205], [255, 250]] },
      { "type": "clarity", "amount": 20 },
      { "type": "noise", "amount": 6, "monochrome": true },
      { "type": "vignette", "amount": 35 }
    ] }
  ]
}
```

## 4. Background blur (portrait mode)

`bg` is a copy of the photo with the **inverted** subject mask (`mask generate photo --method subject --invert --target copy --copy-id bg`) and a `blur`: only the background behind the subject softens. Fluffy edges (fur, hair) keep a soft transition; lower `radius` if a halo shows around the subject.

```json
{
  "version": 1,
  "id": "cat-portrait-mode",
  "title": "Background blur (portrait mode)",
  "canvas": { "width": 1600, "height": 1067 },
  "layers": [
    { "id": "photo", "type": "image", "src": "library:pet", "x": 0, "y": 0, "width": 1600, "height": 1067 },
    { "id": "bg", "type": "image", "name": "Background (blurred copy)", "src": "library:pet", "x": 0, "y": 0, "width": 1600, "height": 1067,
      "mask": { "src": "assets/masks/bg-subject.png", "invert": true },
      "filters": [{ "type": "blur", "radius": 14 }] },
    { "id": "grade", "type": "adjustment", "filters": [
      { "type": "vibrance", "vibrance": 30 },
      { "type": "look", "look": "warm", "amount": 0.5 }
    ] }
  ]
}
```

## 5. Square post with a caption

A landscape photo filling a square with `fit: "cover"` (`focus` chooses what stays in the frame), a golden-hour look, a fill layer with a transparent-to-dark gradient for text contrast, a serif title and a small credit. Text `y` + lines × `size` × `lineHeight` must stay inside the canvas.

```json
{
  "version": 1,
  "id": "lake-post",
  "title": "Square post with a caption",
  "canvas": { "width": 1080, "height": 1080, "background": "#0b1320" },
  "layers": [
    { "id": "photo", "type": "image", "src": "library:landscape", "x": 0, "y": 0, "width": 1080, "height": 1080, "fit": "cover", "focus": [0.55, 0.5],
      "filters": [{ "type": "look", "look": "golden-hour", "amount": 0.6 }] },
    { "id": "shade", "type": "fill", "fill": { "type": "linear", "angle": 90, "stops": [[0, "rgba(11,19,32,0)"], [0.55, "rgba(11,19,32,0)"], [1, "rgba(11,19,32,0.85)"]] } },
    { "id": "title", "type": "text", "text": "Slow mornings\nat the lake", "x": 72, "y": 800, "width": 936, "font": "playfair", "size": 84, "weight": 700, "lineHeight": 1.05, "color": "#ffffff",
      "effects": { "dropShadow": { "opacity": 0.4, "blur": 18, "distance": 4 } } },
    { "id": "credit", "type": "text", "text": "@yourname", "x": 72, "y": 1000, "font": "inter", "size": 26, "weight": 600, "letterSpacing": 1, "color": "rgba(255,255,255,0.8)" }
  ]
}
```
