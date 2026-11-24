# Patch ops

`doc patch` applies a list of ops **atomically**: they are applied in order, the result is validated, and nothing is written if any op fails or the document becomes invalid (`error.details.opIndex` says which op). `--dry-run` prints the plan without writing; removing layers prints `needsConfirmation` until `--yes`.

```bash
python3 <skill dir>/scripts/agentphoto.py doc patch --project my-photo --file ops.json --dry-run --json
python3 <skill dir>/scripts/agentphoto.py doc patch --project my-photo --file ops.json --json
python3 <skill dir>/scripts/agentphoto.py doc patch --project my-photo --json '[{"op":"set","path":"layers#title.size","value":96}]'
```

## Ops

| Op | Shape |
|---|---|
| `set` | `{ "op": "set", "path": "canvas.background", "value": "#111111" }` (creates missing keys) |
| `merge` | `{ "op": "merge", "path": "layers#title.effects", "value": { "stroke": { "color": "#000000", "width": 3 } } }` (deep merge; `null` deletes a key) |
| `remove` | `{ "op": "remove", "path": "layers#title.effects.stroke" }` |
| `addLayer` | `{ "op": "addLayer", "layer": { "id": "title", "type": "text", "text": "Old town" }, "above": "photo" }` (also `below`, `parent` + `index`; default: top) |
| `updateLayer` | `{ "op": "updateLayer", "id": "title", "set": { "color": "#ffd166" } }` (deep merge; `null` removes a field; `id`, `type`, `children` can't change) |
| `removeLayer` | `{ "op": "removeLayer", "id": "title-shadow" }` (with its children; needs `--yes`) |
| `moveLayer` | `{ "op": "moveLayer", "id": "title-shadow", "below": "title" }` (or `above`, `parent` + `index`) |
| `duplicateLayer` | `{ "op": "duplicateLayer", "id": "title", "newId": "title-shadow", "offset": [6, 6] }` |
| `groupLayers` | `{ "op": "groupLayers", "ids": ["title", "title-shadow"], "id": "heading", "name": "Heading" }` |
| `ungroup` | `{ "op": "ungroup", "id": "heading" }` |
| `addFilter` | `{ "op": "addFilter", "id": "photo", "filter": { "type": "exposure", "exposure": 0.2 } }` (`index` to insert) |
| `updateFilter` | `{ "op": "updateFilter", "id": "photo", "index": 0, "set": { "exposure": 0.3 } }` |
| `removeFilter` | `{ "op": "removeFilter", "id": "photo", "index": 1 }` |
| `setMask` | `{ "op": "setMask", "id": "photo", "mask": { "shape": "ellipse", "x": 100, "y": 50, "width": 1400, "height": 960, "feather": 80 } }` (`null` removes it) |
| `crop` | `{ "op": "crop", "x": 0, "y": 0, "width": 1600, "height": 900 }` (canvas px) |
| `resizeCanvas` | `{ "op": "resizeCanvas", "width": 1800, "height": 1200, "anchor": "center" }` (adds or cuts space; layers keep their size) |
| `resizeImage` | `{ "op": "resizeImage", "width": 1280 }` (or `height`, `scale`: scales every layer) |
| `rotateCanvas` | `{ "op": "rotateCanvas", "angle": 90 }` (90, 180, 270 clockwise) |
| `flipCanvas` | `{ "op": "flipCanvas", "axis": "horizontal" }` (text layers move but stay readable) |

All of these ops were run together on one project (`set`, `addLayer`, `updateLayer`, `merge`, `addFilter` × 2, `updateFilter`, `removeFilter`, `duplicateLayer`, `moveLayer`, `groupLayers`, `setMask`, `set` on a mask field, `remove` in one patch; then `ungroup`, `removeLayer`, `resizeCanvas`, `rotateCanvas`, `flipCanvas` with `--yes`).

## Paths

- `canvas.width`, `canvas.background`, `title`, `export.format`
- `layers#<id>.<field>`: a layer by id, anywhere in the tree (groups included): `layers#title.size`, `layers#photo.mask.feather`
- array items: `layers#photo.filters[0].radius`, `layers#title.background.padding[0]`
- `doc get --path <path>` reads any of them: `doc get --path 'layers#title.size' --project my-photo --json`

## Shortcuts (same validation, same plans)

```bash
python3 <skill dir>/scripts/agentphoto.py layer update title --set size=96 --set color=#ffd166 --project my-photo --json
python3 <skill dir>/scripts/agentphoto.py layer update title --set effects.dropShadow.blur=24 --project my-photo --json
python3 <skill dir>/scripts/agentphoto.py layer update title --set mask=null --project my-photo --json
python3 <skill dir>/scripts/agentphoto.py layer move title --above photo --project my-photo --json
python3 <skill dir>/scripts/agentphoto.py filter add photo --type exposure --set exposure=0.3 --project my-photo --json
python3 <skill dir>/scripts/agentphoto.py filter update photo 0 --set exposure=0.2 --project my-photo --json
python3 <skill dir>/scripts/agentphoto.py mask set photo --mask '{"gradient":{"type":"linear","angle":0,"stops":["black","white"]}}' --project my-photo --json
python3 <skill dir>/scripts/agentphoto.py mask clear photo --project my-photo --json
python3 <skill dir>/scripts/agentphoto.py layer remove title --project my-photo --json
python3 <skill dir>/scripts/agentphoto.py layer remove title --yes --project my-photo --json
```

`--set` takes dotted keys and JSON values: numbers and `true` / `false` / `null` are parsed, other text stays a string (`--set color=#ffd166`, `--set font=inter`); arrays and objects need quotes (`--set 'focus=[0.5,0.3]'`), and so does text with a line break, as a JSON string (`--set 'text="Line one\nline two"'`).

## Gotchas

- `updateLayer` / `merge` keep keys you don't mention. To replace a whole filter list or effects object, use `set` on `layers#<id>.filters` or `layers#<id>.effects`.
- Filter indexes shift after `removeFilter`; read `layer list` again before the next index-based op.
- Box layers (image, text, shape) have masks in **layer-local** pixels (the mask moves with the layer); fill / adjustment / group masks are in canvas pixels.
- Layers are listed bottom → top in `photo.json`, but `doc summary` and `layer list` print them top → bottom.
