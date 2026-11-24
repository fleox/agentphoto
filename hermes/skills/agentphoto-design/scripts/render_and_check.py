#!/usr/bin/env python3
"""Renders an AgentPhoto project headless (optionally before / after, a zoom or one layer) and runs `check`, then prints the images to look at and a compact verdict.

    python3 render_and_check.py --project my-photo [--compare] [--zoom x,y,w,h] [--layer <id>] [--max-width 1000]

Read-only for the document (writes PNGs into <project>/renders/). Open every path in `data.images` with your
image viewer / vision tool, then fix what you see. `data.ok` is true when check has no errors and no warnings
and every layer rendered.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agentphoto import AgentPhotoError, run  # noqa: E402


def render_args(compare: bool, zoom: str, layer: str, max_width: int) -> List[str]:
    args: List[str] = ["render"]
    if compare:
        args.append("--compare")
    if zoom:
        args += ["--zoom", zoom]
    if layer:
        args += ["--layer", layer]
    if max_width:
        args += ["--max-width", str(max_width)]
    return args


def run_check(project: str, timeout: float) -> Dict[str, Any]:
    # `check` exits 1 when not ok but still answers ok: true with the report.
    try:
        return run("check", project=project, timeout=timeout) or {}
    except AgentPhotoError as err:
        if isinstance(err.details, dict) and "issues" in err.details:
            return {"ok": False, "issues": err.details["issues"], "counts": {}}
        raise


def verdict(render: Dict[str, Any], check: Dict[str, Any]) -> Dict[str, Any]:
    issues = check.get("issues") or []
    errors = [i for i in issues if i.get("severity") == "error"]
    warnings = [i for i in issues if i.get("severity") == "warning"]
    failed = list(render.get("errors") or [])
    images = list(render.get("files") or [])
    lines = [f"Look at {', '.join(images) or 'the render'} before deciding anything."]
    if len(images) == 2:
        lines.append("The first image is before (no filters, no adjustment layers), the second is after.")
    lines.append(f"check: {len(errors)} error(s), {len(warnings)} warning(s)")
    for i in (errors + warnings)[:12]:
        lines.append(f"- {i.get('severity')} {i.get('path')}: {i.get('message')}" + (f" ({i['hint']})" if i.get("hint") else ""))
    for f in failed[:8]:
        lines.append(f"- render failed for layer {f.get('layer')}: {f.get('message')}")
    if check.get("licences"):
        lines.append(f"- {len(check['licences'])} file(s) need a credit: tell the user (see check.licences)")
    return {
        "ok": not errors and not warnings and not failed,
        "images": images,
        "preview": images[-1] if images else None,
        "before": images[0] if len(images) == 2 else None,
        "size": render.get("size"),
        "canvas": render.get("canvas"),
        "renderErrors": failed,
        "check": {"ok": check.get("ok"), "counts": check.get("counts"), "issues": issues, "licences": check.get("licences", [])},
        "summary": "\n".join(lines),
    }


def collect(project: str, compare: bool, zoom: str, layer: str, max_width: int, timeout: float) -> Dict[str, Any]:
    render = run(*render_args(compare, zoom, layer, max_width), project=project, timeout=timeout) or {}
    check = run_check(project, timeout)
    return {"project": project, **verdict(render, check)}


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--project", required=True)
    p.add_argument("--compare", action="store_true", help="also render the photo before filters / adjustment layers")
    p.add_argument("--zoom", default="", help="x,y,w,h in canvas px, rendered at 1:1 (edges, skin, text)")
    p.add_argument("--layer", default="", help="render only this layer (a mask or a copy)")
    p.add_argument("--max-width", dest="max_width", type=int, default=0)
    p.add_argument("--timeout", type=float, default=240)
    a = p.parse_args(argv)
    try:
        report = collect(a.project, a.compare, a.zoom, a.layer, a.max_width, a.timeout)
    except AgentPhotoError as err:
        print(json.dumps(err.as_json(), indent=2, ensure_ascii=False))
        return err.exit_code or 1
    print(json.dumps({"ok": True, "data": report}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
