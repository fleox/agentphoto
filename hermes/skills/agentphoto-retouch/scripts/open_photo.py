#!/usr/bin/env python3
"""Opens a photo as an AgentPhoto project in one step (or starts from a template), measures it with `analyze`, optionally applies the suggested corrections as an adjustment layer, and renders a first preview.

    python3 open_photo.py my-photo --image ./photo.jpg [--template <id>] [--size <preset>] [--title "Document title"]
                          [--text title="Big headline" --text kicker="New"] [--apply-suggestions] [--force] [--no-render]

--text <layer id>=<text> (repeatable) replaces the text of a template's text layer (`\\n` = new line); `templates show <id>`
lists them.
--apply-suggestions adds the filters `analyze` suggests to an adjustment layer `correct` (editable, removable)
and renders before / after. Suggestions are measurements, not orders: look at the images and keep, tune or
remove them. Prints the project folder, the measurements, the images to look at and the next step.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agentphoto import AgentPhotoError, run  # noqa: E402

# The analyze fields worth reading (the rest is in the full `analyze` output).
KEYS = ("width", "height", "brightness", "contrast", "range", "clippedShadows", "clippedHighlights", "saturation", "cast", "sharpness", "dominant")


def correction_layer(suggestions: List[Dict[str, Any]]) -> Dict[str, Any]:
    filters = [s["filter"] for s in suggestions if isinstance(s.get("filter"), dict)]
    return {"id": "correct", "type": "adjustment", "name": "Correction", "filters": filters}


def text_updates(pairs: List[str]) -> List[Tuple[str, str]]:
    out = []
    for pair in pairs:
        layer, sep, text = pair.partition("=")
        if not sep or not layer.strip():
            raise AgentPhotoError("usage", f'--text expects <layer id>=<text>, got "{pair}".', 'e.g. --text title="Big sale"', 2)
        out.append((layer.strip(), text.replace("\\n", "\n")))
    return out


def create(a: argparse.Namespace) -> Dict[str, Any]:
    texts = text_updates(a.text)
    args: List[str] = ["new", a.dir]
    for flag, value in (("--image", a.image), ("--template", a.template), ("--size", a.size), ("--title", a.title)):
        if value:
            args += [flag, value]
    if a.force:
        args.append("--force")
    created = run(*args, timeout=a.timeout)
    project = created.get("dir", a.dir)
    out: Dict[str, Any] = {
        "dir": project,
        "canvas": created.get("canvas"),
        "layers": [l.get("id") for l in created.get("layers", [])],
    }
    for layer, text in texts:
        run("layer", "update", layer, "--layer", json.dumps({"text": text}), project=project, timeout=a.timeout)
    if texts:
        out["texts"] = dict(texts)
    has_photo = "photo" in out["layers"]
    if has_photo:
        # The photo alone, not the template's text and shapes around it.
        stats = run("analyze", "--layer", "photo", project=project, timeout=a.timeout) or {}
        out["analysis"] = {k: stats[k] for k in KEYS if k in stats}
        out["suggestions"] = stats.get("suggestions", [])
        if a.apply_suggestions and out["suggestions"]:
            layer = correction_layer(out["suggestions"])
            run("layer", "add", "--layer", json.dumps(layer), project=project, timeout=a.timeout)
            out["applied"] = layer
    if not a.no_render:
        compare = bool(out.get("applied"))
        render = run("render", *(["--compare"] if compare else []), project=project, timeout=a.timeout) or {}
        out["images"] = render.get("files", [])
        out["renderErrors"] = render.get("errors", [])
    if has_photo:
        out["next"] = "Look at the images, then correct with an adjustment layer (filters), mask, crop or add text, and render again."
    elif a.template:
        out["next"] = "No `photo` layer: look at the template's layers (`layer list`) and fill its slots."
    else:
        out["next"] = "Blank canvas: add layers (fill, image, text, shape) with `layer add` or `doc patch`, then render."
    return out


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("dir")
    p.add_argument("--image", default="")
    p.add_argument("--template", default="")
    p.add_argument("--size", default="")
    p.add_argument("--title", default="", help="document title (not a text layer: use --text)")
    p.add_argument("--text", action="append", default=[], help="<layer id>=<text>, repeatable")
    p.add_argument("--apply-suggestions", dest="apply_suggestions", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--no-render", dest="no_render", action="store_true")
    p.add_argument("--timeout", type=float, default=240)
    a = p.parse_args(argv)
    if not (a.image or a.template or a.size):
        p.error("give --image (a photo), --template or --size")
    try:
        report = create(a)
    except AgentPhotoError as err:
        print(json.dumps(err.as_json(), indent=2, ensure_ascii=False))
        return err.exit_code or 1
    print(json.dumps({"ok": True, "data": report}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
