#!/usr/bin/env python3
"""A stand-in for the agentphoto CLI in tests (AGENTPHOTO_CMD="python3 fake_engine.py").

Appends every call (argv, plus stdin when it is not empty) as one JSON line to
$FAKE_LOG and answers from the JSON file $FAKE_SCRIPT: a list of
[args prefix, response] pairs; the first prefix that matches the call wins.
A response is the CLI's JSON object, or {"__raw__": "text"} to print raw text,
plus an optional "__exit__" code.
"""

import json
import os
import sys

args = sys.argv[1:]
stdin = "" if sys.stdin is None or sys.stdin.isatty() else sys.stdin.read()
with open(os.environ["FAKE_LOG"], "a", encoding="utf-8") as fh:
    fh.write(json.dumps(args) + "\n")
    if stdin:
        fh.write(json.dumps({"stdin": stdin}) + "\n")
print("progress line", file=sys.stderr)
for prefix, response in json.load(open(os.environ["FAKE_SCRIPT"], encoding="utf-8")):
    if args[: len(prefix)] == prefix:
        code = response.pop("__exit__", 0) if isinstance(response, dict) else 0
        if isinstance(response, dict) and "__raw__" in response:
            print(response["__raw__"])
        else:
            print("some log line")
            print(json.dumps(response))
        sys.exit(code)
print(json.dumps({"ok": False, "error": {"code": "unexpected", "message": f"fake engine: no answer for {args}"}}))
sys.exit(1)
