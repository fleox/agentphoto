# "Export every size at once" demo for the README: the published agentphoto
# CLI checks a corrected photo (prepared by setup.sh), exports three social
# formats in one go, re-runs (--json: needsConfirmation + the overwrite plan) and
# confirms with --yes. render.sh speeds up the long waits (visible label)
# and appends the three exported files side by side.
#   .github/demos/render.sh export
Output .github/assets/demo-export.gif

Set Shell "bash"
Set FontSize 18
Set Width 1200
Set Height 680
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 30ms
Set WindowBar Colorful

Hide
Type "export TMPDIR=/tmp BASH_SILENCE_DEPRECATION_WARNING=1 npm_config_cache=/tmp/ap-cli-demo/npm-cache npm_config_update_notifier=false PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/ap-cli-demo/work/postcard && source /tmp/ap-cli-demo/timing.sh && clear"
Enter
Sleep 500ms
Show

Set TypingSpeed 15ms
Type "alias agentphoto='npx -y @fleox/agentphoto@0.1.0'"
Set TypingSpeed 30ms
Sleep 300ms
Enter
Sleep 500ms

Type "agentphoto check"
Sleep 400ms
Enter
Wait@120s /❯ ?$/
Sleep 1500ms

Type `V='[{"preset":"og","format":"jpeg"},{"preset":"square","format":"webp"},{"preset":"story","format":"webp"}]'`
Sleep 400ms
Enter
Sleep 500ms

Type `agentphoto export --variants "$V"`
Sleep 400ms
Enter
Wait@120s /❯ ?$/
Sleep 4s

Type "clear"
Enter
Sleep 600ms
Type `agentphoto export --variants "$V" --json | jq -c '.data | {needsConfirmation, overwrite: .plan.overwrite}'`
Sleep 400ms
Enter
Wait@120s /❯ ?$/
Sleep 3s

Type `agentphoto export --variants "$V" --yes`
Sleep 400ms
Enter
Wait@120s /❯ ?$/
Sleep 4s
