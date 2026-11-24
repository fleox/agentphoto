#!/usr/bin/env bash
# Renders a README terminal demo GIF with VHS from the published agentphoto
# package. Rebuilds the throw-away demo projects first (setup.sh), so every
# render starts from the same files.
#   .github/demos/render.sh cli|render|export|mcp   (from anywhere)
# Needs vhs, ttyd, ffmpeg, jq, magick (ImageMagick 7), python3, perl,
# Node >= 22 and an installed Chrome (headless renders).
#
# Waits: the tapes source timing.sh (setup.sh), which logs when each npx
# command starts and ends; every command that ran over 4 s is sped up x8
# with a visible "sped up x8" label (0.3 s kept in real time at each end).
# SPEEDUP="a-b c-d" (seconds into the VHS take) overrides the windows.
# Stills appended after the take (own palette, joined by gifcat.py):
#   render  before | after, from the two renders the tape produced (the
#           pictures the agent looks at)
#   export  the three exported files side by side
#   mcp     the image block render_preview returned (renders/preview.png)
set -euo pipefail
name="${1:?usage: render.sh cli|render|export|mcp}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
gif=".github/assets/demo-$name.gif"
DEMO=/tmp/ap-cli-demo
.github/demos/setup.sh
vhs ".github/demos/$name.tape"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# A still (any aspect) fitted in 1152x632 on the terminal background, 1200x680.
still_filter="scale=1152:632:force_original_aspect_ratio=decrease:flags=lanczos,pad=1200:680:(ow-iw)/2:(oh-ih)/2:color=0x1e1e2e,setsar=1,format=rgba"
# Terminal frames: one shared small palette, only the changed rectangles redrawn.
palette() { echo "split[x][y];[x]palettegen=max_colors=${COLORS:-64}:stats_mode=diff[p];[y][p]paletteuse=dither=none:diff_mode=rectangle"; }

# 1. The take, with its waits sped up.
take="$gif"
if [ -f "$DEMO/timing.log" ]; then
  windows=(${SPEEDUP:-$(awk '$2 == "t0" { t0 = $1 + 0.5 }
    $2 == "s" { s = $1 } $2 == "e" && s { if ($1 - s > 4) printf "%.2f-%.2f ", s - t0 + 0.3, $1 - t0 - 0.3; s = 0 }' "$DEMO/timing.log")})
  k=${#windows[@]}
  if [ "$k" -gt 0 ]; then
    echo "sped up x8: ${windows[*]}"
    n=$((2 * k + 1))
    ins=""; for i in $(seq 0 $((n - 1))); do ins+="[i$i]"; done
    lbs=""; for i in $(seq 0 $((k - 1))); do lbs+="[l$i]"; done
    graph="[0:v]format=rgba,split=$n$ins;[1:v]split=$k$lbs;"
    last=0; parts=""
    for j in $(seq 0 $((k - 1))); do
      w=${windows[$j]}; from=${w%-*}; to=${w#*-}
      graph+="[i$((2 * j))]trim=$last:$from,setpts=PTS-STARTPTS,fps=10[s$((2 * j))];"
      graph+="[i$((2 * j + 1))]trim=$from:$to,setpts=(PTS-STARTPTS)/8,fps=5[f$j];[f$j][l$j]overlay=W-w-24:14[s$((2 * j + 1))];"
      parts+="[s$((2 * j))][s$((2 * j + 1))]"
      last=$to
    done
    graph+="[i$((n - 1))]trim=$last,setpts=PTS-STARTPTS,fps=10[s$((n - 1))];"
    parts+="[s$((n - 1))]"
    ffmpeg -v error -y -i "$gif" -i .github/demos/speed-label-8.png -filter_complex \
      "${graph}${parts}concat=n=$n:v=1:a=0,format=bgra[v]" -map "[v]" -c:v ffv1 "$tmp/take.mkv"
    take="$tmp/take.mkv"
  fi
fi

# 2. The still, if any.
still=""
bg="#1e1e2e"
case "$name" in
  render)
    r="$DEMO/work/lake/renders"
    magick "$r/preview-before.png" "$r/preview.png" -resize 1000x \
      -background "$bg" -splice 32x0 +append -chop 32x0 "$tmp/still.png"
    still="$tmp/still.png"
    ;;
  export)
    d="$DEMO/work/postcard/dist"
    magick "$d/postcard-og.jpg" "$d/postcard-square.webp" "$d/postcard-story.webp" -resize x1000 \
      -background "$bg" -splice 40x0 +append -chop 40x0 "$tmp/still.png"
    still="$tmp/still.png"
    ;;
  mcp) still="$DEMO/work/blog/renders/preview.png" ;;
esac

# 3. Encode. The still gets its own dithered 256-colour palette (sharing the
# terminal's bands it badly); gifcat.py joins the two GIFs as they are.
ffmpeg -v error -y -i "$take" -filter_complex "[0:v]fps=10,format=rgba,$(palette)" "$tmp/take.gif"
if [ -n "$still" ]; then
  ffmpeg -v error -y -framerate "1/${STILL:-4}" -i "$still" -filter_complex \
    "[0:v]$still_filter,split[sx][sy];[sx]palettegen=max_colors=256:stats_mode=single[sp];[sy][sp]paletteuse=dither=sierra2_4a" "$tmp/still.gif"
  python3 .github/demos/gifcat.py "$tmp/take.gif" "$tmp/still.gif" "$gif"
else
  mv "$tmp/take.gif" "$gif"
fi
ls -la "$gif"
