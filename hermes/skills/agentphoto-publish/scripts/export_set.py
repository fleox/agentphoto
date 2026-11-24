#!/usr/bin/env python3
"""Runs the pre-export `check`, then exports the image once or as a set of platform sizes, and prints every file with its size in KB.

    python3 export_set.py --project my-photo [--presets og,square,story] [--format jpeg|png|webp] [--quality 85]
                          [--width 1600] [--fit cover|contain] [--background "#ffffff"] [--yes] [--ignore-check]

Stops before writing anything when check reports errors (missing files, invalid document) unless --ignore-check.
Overwriting existing exports needs --yes: without it nothing is written and `data.needsConfirmation` is true with
the plan (show it to the user first). Presets: `catalog sizes`.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, List

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agentphoto import AgentPhotoError, needs_confirmation, run  # noqa: E402
from render_and_check import run_check  # noqa: E402


def variants(presets: List[str], fmt: str, quality: str, fit: str, background: str) -> List[Dict[str, Any]]:
    out = []
    for preset in presets:
        v: Dict[str, Any] = {"preset": preset}
        if fmt:
            v["format"] = fmt
        if quality:
            v["quality"] = int(quality)
        if fit:
            v["fit"] = fit
        if background:
            v["background"] = background
        out.append(v)
    return out


def export_args(a: argparse.Namespace) -> List[str]:
    presets = [p.strip() for p in a.presets.split(",") if p.strip()]
    args: List[str] = ["export"]
    if presets:
        args += ["--variants", json.dumps(variants(presets, a.format, a.quality, a.fit, a.background))]
    else:
        for flag, value in (("--format", a.format), ("--quality", a.quality), ("--width", a.width), ("--height", a.height), ("--fit", a.fit), ("--background", a.background), ("--name", a.name)):
            if value:
                args += [flag, str(value)]
    if a.yes:
        args.append("--yes")
    return args


def export(a: argparse.Namespace) -> Dict[str, Any]:
    check = run_check(a.project, a.timeout)
    issues = check.get("issues") or []
    errors = [i for i in issues if i.get("severity") == "error"]
    warnings = [i for i in issues if i.get("severity") == "warning"]
    report: Dict[str, Any] = {"project": a.project, "check": {"errors": errors, "warnings": warnings, "licences": check.get("licences", [])}}
    if errors and not a.ignore_check:
        report["exported"] = False
        report["next"] = "check found errors: fix them (each has a hint) and run again. Nothing was exported."
        return report
    data = run(*export_args(a), project=a.project, timeout=a.timeout) or {}
    if needs_confirmation(data):
        report.update({"exported": False, "needsConfirmation": True, "plan": data.get("plan")})
        report["next"] = "These files already exist: ask the user, then run again with --yes to overwrite them."
        return report
    files = data.get("files", [])
    report.update({"exported": True, "files": files, "totalKb": round(sum(float(f.get("kb") or 0) for f in files), 1)})
    # Per-file notes: a cover crop cutting layers, an upscale, a format the browser can't encode.
    notes = [f"{f.get('path')}: {f['note']}" for f in files if f.get("note")]
    if notes:
        report["notes"] = notes
    report["next"] = "Give the user the file paths" + (" and the credits in check.licences" if check.get("licences") else "") + "."
    return report


def main(argv: List[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--project", required=True)
    p.add_argument("--presets", default="", help="comma-separated size presets (og, square, portrait, story, youtube…)")
    p.add_argument("--format", default="", choices=("", "png", "jpeg", "webp", "avif"))
    p.add_argument("--quality", default="")
    p.add_argument("--width", default="")
    p.add_argument("--height", default="")
    p.add_argument("--fit", default="", choices=("", "cover", "contain", "stretch"))
    p.add_argument("--background", default="")
    p.add_argument("--name", default="")
    p.add_argument("--yes", action="store_true", help="overwrite existing exports")
    p.add_argument("--ignore-check", dest="ignore_check", action="store_true")
    p.add_argument("--timeout", type=float, default=300)
    a = p.parse_args(argv)
    try:
        report = export(a)
    except AgentPhotoError as err:
        print(json.dumps(err.as_json(), indent=2, ensure_ascii=False))
        return err.exit_code or 1
    print(json.dumps({"ok": True, "data": report}, indent=2, ensure_ascii=False))
    return 0 if report.get("exported") or report.get("needsConfirmation") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
