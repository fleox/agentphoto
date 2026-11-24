#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ap-film/clips
V=/tmp/ap-visuals; A="${REPO:?set REPO to the agentphoto repository}/.github/assets"
wipe() { ffmpeg -v error -y -loop 1 -t 2.2 -i "$1" -loop 1 -t 5 -i "$2" -filter_complex "[0:v]scale=${4}:${5}:flags=lanczos,setsar=1,fps=30,format=yuv420p[a];[1:v]scale=${4}:${5}:flags=lanczos,setsar=1,fps=30,format=yuv420p[b];[a][b]xfade=transition=wipeleft:duration=1.4:offset=0.8,format=yuv420p" -t 5.5 -c:v libx264 -crf 14 "$3"; }
kb() { local n=$(( $4 * 30 )); ffmpeg -v error -y -loop 1 -i "$1" -vf "scale=$(( $2 * 2 )):$(( $3 * 2 )):flags=lanczos,zoompan=z='1+0.05*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${2}x${3}:fps=30,setsar=1,format=yuv420p" -frames:v $n -c:v libx264 -crf 14 "$5"; }
wipe $V/ba-food/renders/preview-before.png $V/ba-food/renders/preview.png food.mp4 1350 900
wipe $V/ba-city/renders/preview-before.png $V/ba-city/renders/preview.png city.mp4 1350 900
wipe $V/ba-portrait/renders/preview-before.png $V/ba-portrait/renders/preview.png portrait.mp4 1350 900
wipe /tmp/ap-session-retouch/lake/renders/preview-before.png /tmp/ap-session-retouch/lake/renders/preview.png lake.mp4 1350 900
for t in youtube-thumbnail:1600:900 og-article:1600:840 sale-banner:1600:500 story-promo:506:900 polaroid:720:900 product-white:900:900 social-quote:900:900 avatar-pro:900:900; do
  IFS=: read id w h <<< "$t"; kb $A/showcase-$id.jpg $w $h 3 $id.mp4
done
ls -la
