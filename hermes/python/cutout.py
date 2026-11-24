#!/usr/bin/env python3
"""Removes the background of a layer with local AI (optionally creating the project from a photo), puts the subject on a new background, crops around it and renders the result plus a zoom on its edge.

    python3 cutout.py --project my-photo [--image ./photo.jpg] [--layer photo] [--model rmbg-1.4|modnet]
                      [--background "#ffffff"] [--shadow] [--threshold 128] [--feather 2]
                      [--crop square|tight|none] [--margin 0.15] [--no-render]

--image creates the project first (the folder must not exist). --crop square makes a packshot square around the
subject with --margin of free space on each side (fraction of the square); tight keeps the subject's aspect
(stickers). Nothing is uploaded; the first run downloads the model once (RMBG-1.4 168 MB, non-commercial licence;
MODNet 25 MB, Apache-2.0, portraits). Prints the subject box, the crop and the images to look at.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agentphoto import AgentPhotoError, patch, run  # noqa: E402


def crop_rect(subject: Optional[Dict[str, float]], canvas: Dict[str, float], mode: str, margin: float) -> Optional[Dict[str, int]]:
    """The crop (canvas px) around `subject`: square or tight, `margin` = free space per side, clamped to the canvas."""
    if not subject or mode == "none" or subject.get("width", 0) <= 0 or subject.get("height", 0) <= 0:
        return None
    cw, ch = float(canvas["width"]), float(canvas["height"])
    margin = min(max(margin, 0.0), 0.45)
    sx, sy, sw, sh = (float(subject[k]) for k in ("x", "y", "width", "height"))
    cx, cy = sx + sw / 2, sy + sh / 2
    if mode == "square":
        w = h = max(sw, sh) / (1 - 2 * margin)
        w = h = min(w, cw, ch)
    else:
        w, h = min(sw / (1 - 2 * margin), cw), min(sh / (1 - 2 * margin), ch)
    x = min(max(cx - w / 2, 0.0), cw - w)
    y = min(max(cy - h / 2, 0.0), ch - h)
    rect = {"x": int(round(x)), "y": int(round(y)), "width": int(round(w)), "height": int(round(h))}
    if rect["x"] == 0 and rect["y"] == 0 and rect["width"] >= cw and rect["height"] >= ch:
        return None
    return rect


def edge_zoom(subject: Dict[str, float], crop: Optional[Dict[str, int]], size: int = 320) -> Optional[str]:
    """A 1:1 zoom on the top of the subject (hair, ears, the rim of a product), in the cropped canvas."""
    if not subject:
        return None
    ox, oy = (crop["x"], crop["y"]) if crop else (0, 0)
    x = subject["x"] + subject["width"] / 2 - size / 2 - ox
    y = subject["y"] - size / 4 - oy
    return f"{max(0, int(x))},{max(0, int(y))},{size},{size}"


def cutout(a: argparse.Namespace) -> Dict[str, Any]:
    project = a.project
    out: Dict[str, Any] = {"project": project, "layer": a.layer}
    if a.image:
        created = run("new", project, "--image", a.image, timeout=a.timeout)
        project = created.get("dir", project)
        out["project"] = project
    args: List[str] = ["remove-bg", a.layer]
    for flag, value in (("--model", a.model), ("--background", a.background), ("--threshold", a.threshold), ("--feather", a.feather)):
        if value not in ("", None):
            args += [flag, str(value)]
    if a.shadow:
        args.append("--shadow")
    removed = run(*args, project=project, timeout=a.timeout) or {}
    subject = removed.get("subject")
    out.update({"model": removed.get("model"), "mask": removed.get("mask"), "subject": subject, "plan": (removed.get("plan") or {}).get("summary")})
    if not subject:
        out["note"] = "The model found no subject: try --model modnet (people) or `mask generate --method box` around it."
    if subject and a.crop != "none":
        canvas = ((run("info", project=project, timeout=a.timeout) or {}).get("summary") or {}).get("canvas") or {}
        crop = crop_rect(subject, canvas, a.crop, a.margin) if canvas else None
        if crop:
            patch([{"op": "crop", **crop}], project=project, timeout=a.timeout)
            out["crop"] = crop
    if not a.no_render:
        images: List[str] = []
        zoom = edge_zoom(subject, out.get("crop")) if subject else None
        if zoom:
            # Every render writes renders/preview.png: keep the zoom under its own name.
            for path in (run("render", "--zoom", zoom, project=project, timeout=a.timeout) or {}).get("files", []):
                kept = os.path.join(os.path.dirname(path), "preview-edge.png")
                if os.path.exists(path):
                    shutil.copyfile(path, kept)
                    path = kept
                images.append(path)
            out["zoom"] = zoom
        images = list((run("render", project=project, timeout=a.timeout) or {}).get("files", [])) + images
        out["images"] = images
    out["next"] = "Look at the images (the last one is a 1:1 zoom on the edge); refine with --threshold / --feather or `mask generate`, then export (PNG / WebP keep transparency)."
    if (removed.get("model") or "rmbg-1.4") == "rmbg-1.4":
        out["licence"] = "RMBG-1.4 is non-commercial: for commercial work use --model modnet (people) or Segment Anything masks."
    return out


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--project", required=True)
    p.add_argument("--image", default="")
    p.add_argument("--layer", default="photo")
    p.add_argument("--model", default="")
    p.add_argument("--background", default="")
    p.add_argument("--shadow", action="store_true")
    p.add_argument("--threshold", default="")
    p.add_argument("--feather", default="")
    p.add_argument("--crop", choices=("square", "tight", "none"), default="none")
    p.add_argument("--margin", type=float, default=0.15)
    p.add_argument("--no-render", dest="no_render", action="store_true")
    p.add_argument("--timeout", type=float, default=600)
    a = p.parse_args(argv)
    try:
        report = cutout(a)
    except AgentPhotoError as err:
        print(json.dumps(err.as_json(), indent=2, ensure_ascii=False))
        return err.exit_code or 1
    print(json.dumps({"ok": True, "data": report}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
