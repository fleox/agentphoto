# Cut-out demo for the README (demo-cutout.gif) and the film: a REAL Claude Code
# session with the agentphoto plugin (marketplace fleox/agentphoto, plugin and CLI
# @fleox/agentphoto@0.1.0). Not reproducible as is: the recording is reviewed,
# then the agent's work is sped up with a visible label.
# How the environment was prepared (not recorded):
# - /tmp/ap-session-{retouch,cutout,design}, each with .claude/settings.json:
#   extraKnownMarketplaces agentphoto (github fleox/agentphoto), enabledPlugins
#   agentphoto@agentphoto, permissions.defaultMode "auto", the CLI
#   (`npx -y @fleox/agentphoto@0.1.0 …`) plus Read / Write / Edit / ls / cat /
#   mkdir / cp pre-approved; plugin installed at project scope
#   (`claude plugin marketplace add fleox/agentphoto --scope project`,
#   `claude plugin install agentphoto@agentphoto --scope project`); each folder
#   trusted once (a hidden VHS run answering the trust dialog). The sample photo
#   copied in: lake.jpg (library landscape), mug.jpg (product), street.jpg (city).
# - CLAUDE_CODE_PLUGIN_CACHE_DIR, npm_config_cache and AGENTPHOTO_MODELS under /tmp
#   so no path under the owner's home shows on screen; /tmp/ap-demo-bin/zsh
#   (`exec /bin/zsh -o shwordsplit "$@"`) and /tmp/ap-demo-bin/ls
#   (`exec /bin/ls -g -o "$@"`) keep the account name out of the output.
# Every frame was OCR-checked (macOS Vision) for /Users paths, the account name and
# its domain before composing. The design take showed the domain in Claude Code's
# prompt suggestion after the agent finished: that line is covered first with
#   ffmpeg -i design.mp4 -vf "drawbox=x=44:y=780:w=1520:h=30:color=0x1e1e2e:t=fill:enable='gte(t,170)'" design-clean.mp4
#
# Compose (from the repository root):
#   COLORS=128 FASTFPS=4 .github/demos/compose.sh /tmp/ap-rec/cutout.mp4 .github/assets/demo-cutout.gif 15.3 136 10 8 /tmp/ap-session-cutout/shop/dist/shop-2000x2000.jpg
# The still is the agent's own result from that take.

Output "/tmp/ap-rec/cutout.mp4"

Set Shell "bash"
Set FontSize 20
Set Width 1600
Set Height 900
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set WindowBar Colorful

Hide
Type `export BASH_SILENCE_DEPRECATION_WARNING=1; unset $(compgen -e | grep -E '^CLAUDE'); export PATH=/tmp/ap-demo-bin:$PATH SHELL=/tmp/ap-demo-bin/zsh CLAUDE_CODE_SHELL=/tmp/ap-demo-bin/zsh CLAUDE_CODE_PLUGIN_CACHE_DIR=/tmp/ap-demo-plugins npm_config_cache=/tmp/ap-npm-cache npm_config_update_notifier=false AGENTPHOTO_MODELS=/tmp/ap-models TMPDIR=/tmp`
Enter
Type "alias claude='claude --setting-sources project,local' && export PS1='\[\e[38;5;141m\]❯\[\e[0m\] ' && cd /tmp/ap-session-cutout && clear"
Enter
Sleep 500ms
Show

Type "claude"
Enter
Sleep 7s

Type `Remove the background of mug.jpg and make a clean product photo for my shop: on white, square, with a soft shadow under the mug. Export it as a 2000 px JPEG. Go ahead without asking.`
Sleep 1s
Enter
Sleep 1080s
