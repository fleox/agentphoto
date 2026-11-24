# "Render headless and look at it" demo for the README: the published
# agentphoto CLI renders a corrected photo (prepared by setup.sh) in the
# installed Chrome, before and after; render.sh then appends those two very
# renders side by side as a still, the pictures the agent looks at.
#   .github/demos/render.sh render
Output .github/assets/demo-render.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 npm_config_cache=/tmp/ap-cli-demo/npm-cache npm_config_update_notifier=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/ap-cli-demo/work/lake && source /tmp/ap-cli-demo/timing.sh && clear"
Enter
Sleep 500ms
Show

Set TypingSpeed 15ms
Type "alias agentphoto='npx -y @fleox/agentphoto@0.1.0'"
Set TypingSpeed 30ms
Sleep 300ms
Enter
Sleep 500ms

Type "agentphoto layer list"
Sleep 400ms
Enter
Wait@120s /❯ ?$/
Sleep 2500ms

Type "agentphoto render --compare"
Sleep 400ms
Enter
Wait@120s /❯ ?$/
Sleep 1500ms

Type "agentphoto analyze --json | jq -c '.data | {brightness, contrast, cast, suggestions}'"
Sleep 400ms
Enter
Wait@120s /❯ ?$/
Sleep 4s
