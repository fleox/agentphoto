# "Retouch a photo from the terminal" demo for the README: the published
# agentphoto CLI in a throw-away folder prepared by setup.sh — a project from
# a photo, its measurements (analyze suggests filters), an adjustment layer
# with those suggestions, a look on top, the layer stack, the pre-export check.
#   .github/demos/render.sh cli   (from the repository root; needs vhs, ttyd, ffmpeg, jq)
Output .github/assets/demo-cli.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 npm_config_cache=/tmp/ap-cli-demo/npm-cache npm_config_update_notifier=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/ap-cli-demo/work && source /tmp/ap-cli-demo/timing.sh && clear"
Enter
Sleep 500ms
Show

Set TypingSpeed 15ms
Type "alias agentphoto='npx -y @fleox/agentphoto@0.1.0'"
Set TypingSpeed 30ms
Sleep 300ms
Enter
Sleep 500ms

Type "agentphoto new trip --image lake.jpg && cd trip"
Sleep 300ms
Enter
Wait@120s /❯ ?$/
Sleep 1500ms

Type "agentphoto analyze --json | jq -c '.data | {brightness, contrast, cast}, .suggestions[]'"
Sleep 300ms
Enter
Wait@120s /❯ ?$/
Sleep 3500ms

Type "clear"
Enter
Sleep 600ms
Type `agentphoto layer add --id grade --type adjustment --set 'filters=[{"type":"autoContrast"},{"type":"temperature","temperature":28}]'`
Sleep 300ms
Enter
Wait@120s /❯ ?$/
Sleep 1500ms

Type "agentphoto filter add grade --type look --set look=golden-hour --set amount=0.6"
Sleep 300ms
Enter
Wait@120s /❯ ?$/
Sleep 1500ms

Type "agentphoto layer list"
Sleep 300ms
Enter
Wait@120s /❯ ?$/
Sleep 2500ms

Type "agentphoto check"
Sleep 300ms
Enter
Wait@120s /❯ ?$/
Sleep 5s
