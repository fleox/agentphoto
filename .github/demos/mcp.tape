# MCP demo for the README: speak raw JSON-RPC to the published agentphoto MCP
# server (stdio) on a link-preview project prepared by setup.sh: initialize,
# tools/list and a render_preview call that returns the picture as an image
# block. render.sh appends that image as a still (what a multimodal client sees).
#   .github/demos/render.sh mcp
Output .github/assets/demo-mcp.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 npm_config_cache=/tmp/ap-cli-demo/npm-cache npm_config_update_notifier=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/ap-cli-demo/work/blog && source /tmp/ap-cli-demo/timing.sh && clear"
Enter
Sleep 500ms
Show

Set TypingSpeed 15ms
Type "alias agentphoto='npx -y @fleox/agentphoto@0.1.0'"
Set TypingSpeed 30ms
Sleep 300ms
Enter
Sleep 500ms

Type "jq -c '{id, method, tool: .params.name}' session.jsonl   # what a client sends"
Sleep 400ms
Enter
Sleep 3s

Type "agentphoto mcp --project . < session.jsonl 2>/dev/null | jq -c -f show.jq"
Sleep 400ms
Enter
Wait@120s /❯ ?$/
Sleep 6s
