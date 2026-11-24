#!/usr/bin/env bash
# Prepares the throw-away projects the README terminal demo tapes use
# (cli, render, export, mcp), from the PUBLISHED package (never the
# repository build: inside the repo, npx would resolve the local package).
# Idempotent: wipes and rebuilds /tmp/ap-cli-demo/work every time
# (render.sh runs it before each tape).
#   .github/demos/setup.sh
# Needs Node >= 22, an installed Chrome / Chromium (headless renders), jq.
set -euo pipefail
VERSION="${AGENTPHOTO_DEMO_VERSION:-0.1.0}"
PKG="@fleox/agentphoto@$VERSION"
DEMO=/tmp/ap-cli-demo
IMAGES="$(cd "$(dirname "$0")/../../library/images" && pwd)"
export npm_config_cache="$DEMO/npm-cache"
export npm_config_update_notifier=false npm_config_fund=false npm_config_audit=false

mkdir -p "$DEMO"
cd "$DEMO"
rm -rf work timing.log
mkdir -p work
ap() { npx -y "$PKG" "$@"; }

# Warm the npx cache so nothing downloads while recording.
ap version >/dev/null

cd work
# The grade every corrected project gets: analyze's two suggestions
# (autoContrast, temperature) + a look.
grade() {
  ap layer add --project "$1" --id grade --type adjustment \
    --set 'filters=[{"type":"autoContrast"},{"type":"temperature","temperature":28},{"type":"look","look":"golden-hour","amount":0.6}]' >/dev/null
}
# cli.tape creates its own project (trip) on screen from this photo.
cp "$IMAGES/landscape.jpg" lake.jpg
# render.tape: the lake, corrected (render --compare shows before / after).
ap new lake --image lake.jpg >/dev/null
grade lake
# export.tape: the same corrected lake, never exported (the tape exports,
# re-runs to show the overwrite plan, then --yes).
ap new postcard --image lake.jpg >/dev/null
grade postcard
# mcp.tape: a link preview (og-article template + a street photo) and a raw
# JSON-RPC session (initialize, tools/list, tools/call render_preview) with
# the jq filter that prints the answers.
cp "$IMAGES/city.jpg" street.jpg
ap new blog --template og-article --image street.jpg >/dev/null
rm street.jpg
cat > blog/session.jsonl <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1.0"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":2,"method":"tools/list"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"render_preview","arguments":{"maxWidth":1000}}}
JSON
cat > blog/show.jq <<'JQ'
if .id == 1 then {id, server: .result.serverInfo}
elif .id == 2 then {id, tools: (.result.tools | length), names: ([.result.tools[].name][0:5] + ["…"])}
else .id as $id | .result.content[] | if .type == "image"
  then {id: $id, image: "\(.mimeType), \(.data | length * 3 / 4 / 1024 | floor) KB"}
  else {id: $id, text: (.text | fromjson | {preview, size, canvas})} end end
JQ
# The tapes source this (hidden): it logs when each npx command starts
# ("s") and when the prompt comes back ("e"), so render.sh can find the
# waits to speed up. t0 = when it is sourced
# (the tape shows the terminal ~0.5 s later).
cat > "$DEMO/timing.sh" <<'SH'
AP_LOG=/tmp/ap-cli-demo/timing.log
rm -f "$AP_LOG"
ap_now() { perl -MTime::HiRes=time -e 'printf "%.2f", time'; }
trap 'case $BASH_COMMAND in npx*) echo "$(ap_now) s" >> "$AP_LOG";; esac' DEBUG
PROMPT_COMMAND='echo "$(ap_now) e" >> "$AP_LOG"'
echo "$(ap_now) t0" >> "$AP_LOG"
SH
echo "demo projects ready in $DEMO/work"
