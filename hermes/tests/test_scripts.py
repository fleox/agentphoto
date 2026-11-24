"""Tests of the Hermes Python helpers against a fake agentphoto engine.

    python3 -m unittest discover -s hermes/tests
"""

import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "python"))

import agentphoto  # noqa: E402
import cutout  # noqa: E402
import export_set  # noqa: E402
import open_photo  # noqa: E402
import render_and_check  # noqa: E402


def ok(data):
    return {"ok": True, "data": data}


RENDER = {"preview": "renders/preview.png", "images": ["renders/preview.png"], "size": "1000×667", "canvas": "1600×1067", "files": ["/p/renders/preview.png"]}
COMPARE = {**RENDER, "images": ["renders/preview-before.png", "renders/preview.png"], "files": ["/p/renders/preview-before.png", "/p/renders/preview.png"]}
CHECK_OK = {"ok": True, "issues": [], "counts": {"errors": 0, "warnings": 0, "infos": 0}, "layers": 1, "licences": []}
MISSING = {"severity": "error", "code": "missing-file", "path": "layers#photo.src", "message": "assets/images/a.jpg does not exist in the project.", "hint": "Import it with `agentphoto assets add`."}
CANVAS = {"width": 1600, "height": 1067, "background": "transparent"}


class FakeEngine(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.log = os.path.join(self.dir, "calls.jsonl")
        self.script = os.path.join(self.dir, "script.json")
        os.environ["AGENTPHOTO_CMD"] = f'"{sys.executable}" "{os.path.join(HERE, "fake_engine.py")}"'
        os.environ["FAKE_LOG"] = self.log
        os.environ["FAKE_SCRIPT"] = self.script

    def answer(self, *pairs):
        with open(self.script, "w", encoding="utf-8") as fh:
            json.dump([[list(p), r] for p, r in pairs], fh)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log, encoding="utf-8") as fh:
            return [json.loads(l) for l in fh if l.strip()]

    def commands(self):
        return [c for c in self.calls() if isinstance(c, list)]

    def stdins(self):
        return [c["stdin"] for c in self.calls() if isinstance(c, dict) and "stdin" in c]

    def capture(self, fn, argv):
        buf = StringIO()
        with redirect_stdout(buf):
            code = fn(argv)
        out = buf.getvalue()
        return code, json.loads(out) if out.strip().startswith("{") else out


class WrapperTest(FakeEngine):
    def test_run_returns_data_and_adds_json_and_project(self):
        self.answer((["doc", "summary"], ok({"id": "p", "layers": []})))
        data = agentphoto.run("doc", "summary", project="my-photo")
        self.assertEqual(data["id"], "p")
        self.assertEqual(self.commands()[0], ["doc", "summary", "--project", "my-photo", "--json"])

    def test_commands_without_project(self):
        self.answer((["new"], ok({"dir": "/x/p"})), (["catalog"], ok({})), (["models"], ok({})))
        agentphoto.run("new", "p", "--image", "a.jpg", project="ignored")
        agentphoto.run("catalog", "filters", project="ignored")
        agentphoto.run("models", "list", project="ignored")
        self.assertEqual(self.commands(), [["new", "p", "--image", "a.jpg", "--json"], ["catalog", "filters", "--json"], ["models", "list", "--json"]])

    def test_errors_carry_code_hint_and_details(self):
        issues = [{"severity": "error", "path": "layers#photo.filters[0].type", "message": "Unknown filter"}]
        self.answer((["doc", "patch"], {"ok": False, "error": {"code": "validation", "message": "Invalid", "hint": "Did you mean blur?", "details": {"issues": issues}}, "__exit__": 2}))
        with self.assertRaises(agentphoto.AgentPhotoError) as ctx:
            agentphoto.run("doc", "patch", "--file", "ops.json", project="p")
        e = ctx.exception
        self.assertEqual((e.code, e.hint, e.exit_code), ("validation", "Did you mean blur?", 2))
        self.assertEqual(e.details["issues"], issues)
        self.assertEqual(e.as_json()["error"]["details"]["issues"], issues)

    def test_patch_sends_ops_on_stdin(self):
        self.answer((["doc", "patch"], ok({"applied": True, "plan": {"summary": "updated canvas."}, "issues": []})))
        ops = [{"op": "crop", "x": 0, "y": 0, "width": 800, "height": 800}]
        data = agentphoto.patch(ops, project="p", yes=True)
        self.assertTrue(data["applied"])
        self.assertEqual(self.commands()[0], ["doc", "patch", "--file", "-", "--yes", "--project", "p", "--json"])
        self.assertEqual(json.loads(self.stdins()[0]), ops)

    def test_no_json_output(self):
        self.answer((["doctor"], {"__raw__": "boom", "__exit__": 1}))
        with self.assertRaises(agentphoto.AgentPhotoError) as ctx:
            agentphoto.run("doctor")
        self.assertEqual(ctx.exception.code, "no-output")

    def test_node_missing_is_explained(self):
        del os.environ["AGENTPHOTO_CMD"]
        path = os.environ.get("PATH", "")
        os.environ["PATH"] = self.dir
        try:
            with self.assertRaises(agentphoto.AgentPhotoError) as ctx:
                agentphoto.engine_command()
            self.assertEqual(ctx.exception.code, "node-missing")
            self.assertIn("nodejs.org", ctx.exception.hint)
        finally:
            os.environ["PATH"] = path

    def test_pinned_package(self):
        self.assertEqual(agentphoto.PACKAGE, "@fleox/agentphoto")
        self.assertEqual(agentphoto.MIN_NODE, (22, 0))

    def test_needs_confirmation_and_result(self):
        self.assertTrue(agentphoto.needs_confirmation({"needsConfirmation": True, "plan": {}}))
        self.assertFalse(agentphoto.needs_confirmation({"applied": True}))
        self.assertTrue(agentphoto.needs_confirmation({"tool": "layer_remove", "result": {"needsConfirmation": True}}))
        self.assertEqual(agentphoto.result({"tool": "check", "result": [1]}), [1])

    def test_main_prints_the_cli_object_and_exit_code(self):
        self.answer((["check"], {**ok({"ok": False, "issues": [MISSING]}), "__exit__": 1}))
        code, out = self.capture(agentphoto.main, ["check", "--project", "p"])
        self.assertEqual(code, 1)
        self.assertTrue(out["ok"])


class RenderAndCheckTest(FakeEngine):
    def test_compare_render_then_check(self):
        self.answer((["render"], ok(COMPARE)), (["check"], ok(CHECK_OK)))
        code, out = self.capture(render_and_check.main, ["--project", "p", "--compare", "--max-width", "800"])
        self.assertEqual(code, 0)
        data = out["data"]
        self.assertTrue(data["ok"])
        self.assertEqual(data["before"], "/p/renders/preview-before.png")
        self.assertEqual(data["preview"], "/p/renders/preview.png")
        self.assertIn("before", data["summary"])
        render, check = self.commands()
        self.assertEqual(render, ["render", "--compare", "--max-width", "800", "--project", "p", "--json"])
        self.assertEqual(check, ["check", "--project", "p", "--json"])

    def test_zoom_and_layer(self):
        self.answer((["render"], ok(RENDER)), (["check"], ok(CHECK_OK)))
        self.capture(render_and_check.main, ["--project", "p", "--zoom", "10,20,300,300", "--layer", "bg"])
        self.assertEqual(self.commands()[0], ["render", "--zoom", "10,20,300,300", "--layer", "bg", "--project", "p", "--json"])

    def test_problems_make_it_not_ok(self):
        bad = {**CHECK_OK, "ok": False, "issues": [MISSING], "counts": {"errors": 1, "warnings": 0}, "licences": [{"path": "assets/images/a.jpg", "license": "CC-BY-4.0"}]}
        render = {**RENDER, "errors": [{"layer": "photo", "message": "assets/images/a.jpg: HTTP 404"}]}
        self.answer((["render"], ok(render)), (["check"], {**ok(bad), "__exit__": 1}))
        code, out = self.capture(render_and_check.main, ["--project", "p"])
        self.assertEqual(code, 0)
        data = out["data"]
        self.assertFalse(data["ok"])
        self.assertIn("does not exist", data["summary"])
        self.assertIn("HTTP 404", data["summary"])
        self.assertIn("credit", data["summary"])
        self.assertIsNone(data["before"])

    def test_render_failure_is_reported(self):
        self.answer((["render"], {"ok": False, "error": {"code": "browser-missing", "message": "No Chrome", "hint": "Install Google Chrome"}, "__exit__": 1}))
        code, out = self.capture(render_and_check.main, ["--project", "p"])
        self.assertEqual(code, 1)
        self.assertEqual(out["error"]["hint"], "Install Google Chrome")


class OpenPhotoTest(FakeEngine):
    ANALYZE = {"width": 1200, "height": 800, "brightness": 92, "saturation": 13, "cast": {"warm": 3}, "suggestions": [{"issue": "Muted colours", "filter": {"type": "vibrance", "vibrance": 35}}, {"issue": "Dark", "filter": {"type": "exposure", "exposure": 0.3}}]}

    def test_opens_analyzes_applies_and_compares(self):
        self.answer(
            (["new"], ok({"dir": "/x/p", "canvas": CANVAS, "layers": [{"id": "photo", "type": "image"}]})),
            (["analyze"], ok(self.ANALYZE)),
            (["layer", "add"], ok({"applied": True})),
            (["render"], ok(COMPARE)),
        )
        code, out = self.capture(open_photo.main, ["p", "--image", "./a.jpg", "--apply-suggestions"])
        self.assertEqual(code, 0)
        data = out["data"]
        self.assertEqual(data["dir"], "/x/p")
        self.assertEqual(data["analysis"]["brightness"], 92)
        self.assertEqual(len(data["images"]), 2)
        cmds = self.commands()
        self.assertEqual(cmds[0], ["new", "p", "--image", "./a.jpg", "--json"])
        self.assertEqual(cmds[1], ["analyze", "--layer", "photo", "--project", "/x/p", "--json"])
        layer = json.loads(cmds[2][cmds[2].index("--layer") + 1])
        self.assertEqual(layer["type"], "adjustment")
        self.assertEqual([f["type"] for f in layer["filters"]], ["vibrance", "exposure"])
        self.assertIn("--compare", cmds[3])

    def test_template_without_photo_skips_analyze(self):
        self.answer((["new"], ok({"dir": "/x/t", "canvas": CANVAS, "layers": [{"id": "title"}, {"id": "bg"}]})))
        code, out = self.capture(open_photo.main, ["t", "--template", "sale-banner", "--title", "Sale", "--no-render"])
        self.assertEqual(code, 0)
        self.assertNotIn("analysis", out["data"])
        self.assertIn("slots", out["data"]["next"])
        self.assertEqual(len(self.commands()), 1)

    def test_fills_template_texts(self):
        self.answer(
            (["new"], ok({"dir": "/x/t", "canvas": CANVAS, "layers": [{"id": "title"}, {"id": "photo"}]})),
            (["layer", "update"], ok({"applied": True})),
            (["analyze"], ok({"width": 800, "suggestions": []})),
        )
        code, out = self.capture(open_photo.main, ["t", "--template", "youtube-thumbnail", "--image", "a.jpg", "--text", "title=TOKYO\\nBY NIGHT", "--text", "kicker=2026", "--no-render"])
        self.assertEqual(code, 0)
        updates = [c for c in self.commands() if c[:2] == ["layer", "update"]]
        self.assertEqual([u[2] for u in updates], ["title", "kicker"])
        self.assertEqual(json.loads(updates[0][updates[0].index("--layer") + 1]), {"text": "TOKYO\nBY NIGHT"})
        self.assertEqual(json.loads(updates[1][updates[1].index("--layer") + 1]), {"text": "2026"})
        self.assertEqual(out["data"]["texts"]["kicker"], "2026")

    def test_bad_text_pair_creates_nothing(self):
        code, out = self.capture(open_photo.main, ["t", "--template", "x", "--text", "no-equals"])
        self.assertEqual(code, 2)
        self.assertEqual(out["error"]["code"], "usage")
        self.assertEqual(self.commands(), [])

    def test_blank_canvas(self):
        self.answer((["new"], ok({"dir": "/x/b", "canvas": CANVAS, "layers": []})))
        code, out = self.capture(open_photo.main, ["b", "--size", "og", "--no-render"])
        self.assertEqual(code, 0)
        self.assertIn("Blank canvas", out["data"]["next"])
        self.assertEqual(self.commands(), [["new", "b", "--size", "og", "--json"]])

    def test_needs_a_source(self):
        with self.assertRaises(SystemExit):
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                open_photo.main(["p"])


class CutoutTest(FakeEngine):
    SUBJECT = {"x": 881, "y": 306, "width": 475, "height": 329}

    def test_crop_rect(self):
        c = cutout.crop_rect(self.SUBJECT, CANVAS, "square", 0.15)
        self.assertEqual((c["width"], c["height"]), (679, 679))
        self.assertAlmostEqual(c["x"] + c["width"] / 2, 881 + 475 / 2, delta=1)
        # Clamped to the canvas, and still square.
        big = cutout.crop_rect({"x": 0, "y": 0, "width": 1500, "height": 1000}, CANVAS, "square", 0.15)
        self.assertEqual((big["x"], big["y"], big["width"], big["height"]), (216, 0, 1067, 1067))
        tight = cutout.crop_rect(self.SUBJECT, CANVAS, "tight", 0.1)
        self.assertEqual((tight["width"], tight["height"]), (594, 411))
        self.assertIsNone(cutout.crop_rect(self.SUBJECT, CANVAS, "none", 0.15))
        self.assertIsNone(cutout.crop_rect(None, CANVAS, "square", 0.15))
        # A crop covering the whole canvas is no crop.
        self.assertIsNone(cutout.crop_rect({"x": 0, "y": 0, "width": 1600, "height": 1067}, CANVAS, "tight", 0))

    def test_creates_removes_crops_and_renders(self):
        self.answer(
            (["new"], ok({"dir": "/x/p", "canvas": CANVAS})),
            (["remove-bg"], ok({"mask": "assets/masks/photo-cutout.png", "subject": self.SUBJECT, "model": "rmbg-1.4", "plan": {"summary": "added photo-background"}})),
            (["info"], ok({"dir": "/x/p", "summary": {"canvas": CANVAS}})),
            (["doc", "patch"], ok({"applied": True})),
            (["render"], ok(RENDER)),
        )
        code, out = self.capture(cutout.main, ["--project", "p", "--image", "./mug.jpg", "--background", "#ffffff", "--shadow", "--threshold", "128", "--crop", "square"])
        self.assertEqual(code, 0)
        data = out["data"]
        self.assertEqual(data["subject"], self.SUBJECT)
        self.assertEqual(data["crop"]["width"], 679)
        self.assertIn("non-commercial", data["licence"])
        cmds = self.commands()
        self.assertEqual(cmds[1], ["remove-bg", "photo", "--background", "#ffffff", "--threshold", "128", "--shadow", "--project", "/x/p", "--json"])
        self.assertEqual(json.loads(self.stdins()[0])[0]["op"], "crop")
        # The zoom renders first (on the cropped canvas) and is kept as preview-edge.png; the full render comes first in images.
        zoom = cmds[-2]
        self.assertEqual(zoom[:2], ["render", "--zoom"])
        self.assertEqual(data["zoom"], f"{881 + 475 // 2 - 160 - data['crop']['x']},{306 - 80 - data['crop']['y']},320,320")
        self.assertEqual(cmds[-1], ["render", "--project", "/x/p", "--json"])
        self.assertEqual(data["images"], ["/p/renders/preview.png", "/p/renders/preview.png"])

    def test_no_subject(self):
        self.answer((["remove-bg"], ok({"subject": None, "model": "modnet"})), (["render"], ok(RENDER)))
        code, out = self.capture(cutout.main, ["--project", "p", "--model", "modnet", "--crop", "square"])
        self.assertEqual(code, 0)
        self.assertIn("no subject", out["data"]["note"])
        self.assertNotIn("crop", out["data"])
        self.assertNotIn("licence", out["data"])
        self.assertEqual([c[0] for c in self.commands()], ["remove-bg", "render"])


class ExportSetTest(FakeEngine):
    FILES = [{"path": "dist/p-og.jpg", "format": "jpeg", "width": 1200, "height": 630, "kb": 114.7}, {"path": "dist/p-story.webp", "format": "webp", "width": 1080, "height": 1920, "kb": 90.3, "note": "fit \"cover\" cuts layer title"}]

    def test_checks_then_exports_variants(self):
        self.answer((["check"], ok(CHECK_OK)), (["export"], ok({"files": self.FILES})))
        code, out = self.capture(export_set.main, ["--project", "p", "--presets", "og, story", "--format", "webp", "--quality", "82"])
        self.assertEqual(code, 0)
        data = out["data"]
        self.assertTrue(data["exported"])
        self.assertEqual(data["totalKb"], 205.0)
        self.assertIn("cuts layer title", data["notes"][0])
        cmd = self.commands()[1]
        variants = json.loads(cmd[cmd.index("--variants") + 1])
        self.assertEqual(variants, [{"preset": "og", "format": "webp", "quality": 82}, {"preset": "story", "format": "webp", "quality": 82}])

    def test_single_export_flags(self):
        self.answer((["check"], ok(CHECK_OK)), (["export"], ok({"files": self.FILES[:1]})))
        self.capture(export_set.main, ["--project", "p", "--format", "jpeg", "--width", "1600", "--yes"])
        self.assertEqual(self.commands()[1], ["export", "--format", "jpeg", "--width", "1600", "--yes", "--project", "p", "--json"])

    def test_check_errors_stop_the_export(self):
        self.answer((["check"], {**ok({**CHECK_OK, "ok": False, "issues": [MISSING]}), "__exit__": 1}))
        code, out = self.capture(export_set.main, ["--project", "p"])
        self.assertEqual(code, 1)
        self.assertFalse(out["data"]["exported"])
        self.assertEqual(len(self.commands()), 1)

    def test_overwrite_needs_confirmation(self):
        plan = {"overwrite": ["dist/p.jpg"], "files": [{"path": "dist/p.jpg"}]}
        self.answer((["check"], ok(CHECK_OK)), (["export"], ok({"needsConfirmation": True, "plan": plan})))
        code, out = self.capture(export_set.main, ["--project", "p", "--format", "jpeg"])
        self.assertEqual(code, 0)
        self.assertTrue(out["data"]["needsConfirmation"])
        self.assertEqual(out["data"]["plan"], plan)
        self.assertIn("--yes", out["data"]["next"])


if __name__ == "__main__":
    unittest.main()
