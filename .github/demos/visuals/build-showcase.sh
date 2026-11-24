#!/bin/zsh
# How the README visuals in ../../assets were made (reference; run step by step, look at every image).
# Everything is rendered by the PUBLISHED package, outside the repo. Needs Chrome, ImageMagick (magick), rsvg-convert.
#   V=$PWD (this folder)   W=/tmp/ap-visuals   AP="npx -y @fleox/agentphoto@0.1.0"
set -e
V=${0:A:h}; A=$V/../../assets; W=${W:-/tmp/ap-visuals}; mkdir -p $W/img && cd $W
ap() { npx -y @fleox/agentphoto@0.1.0 "$@"; }
PK=$(ap doctor --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).data.packageRoot))')
cp $PK/library/images/*.jpg img/

# Logo (same drawing as the Studio mark, src/studio/panels/TopBar.tsx)
rsvg-convert -w 512 -h 512 $A/logo.svg -o $A/logo.png

# 1. Templates: one project per template with a fitting sample photo; cut-out templates get remove-bg.
for pair in avatar-pro:portrait og-article:city polaroid:pet product-white:product sale-banner:product social-quote:landscape story-promo:food youtube-thumbnail:portrait; do
  t=${pair%%:*}; ap new t-$t --template $t --image img/${pair##*:}.jpg --force --json
done
ap remove-bg photo --model modnet --project t-avatar-pro --json
ap remove-bg photo --model modnet --project t-youtube-thumbnail --json
# product-white: a new image drops the template crop (the mug ends up tiny) and its blurred floor shadow renders as a hard
# rectangle, so restore the crop, cut out again and draw the shadow as a feathered ellipse mask on a fill layer.
ap layer update photo --set 'crop={"x":800,"y":150,"width":640,"height":640}' --project t-product-white --json
ap remove-bg photo --project t-product-white --json
ap doc patch --project t-product-white '[{"op":"removeLayer","id":"floor-shadow"},{"op":"addLayer","index":0,"layer":{"id":"floor-shadow","type":"fill","name":"Floor shadow","fill":"rgba(0,0,0,0.30)","mask":{"shape":"ellipse","x":600,"y":1240,"width":800,"height":60,"feather":40}}}]' --json
for spec in og-article:1600 youtube-thumbnail:1600 sale-banner:1600 social-quote:1080 polaroid:1080 story-promo:900 product-white:1200 avatar-pro:1000; do
  t=${spec%%:*}; ap export --project t-$t --format jpeg --quality 85 --width ${spec##*:} --background '#ffffff' --name showcase --yes --json
  cp t-$t/dist/showcase-*.jpg $A/showcase-$t.jpg
  ap export --project t-$t --format png --name full --yes --json   # -> grid/<id>.png (downsized) for templates-grid.html
done

# 2. Before / after (recipes from docs/retouching.md and plugin/skills/agentphoto-retouch/references/recipes.md),
#    each rendered with `render --compare --max-width 1600`, then laid out by before-after.html:
#    node shot.mjs "file://$V/before-after.html?before=file://<before.png>&after=file://<after.png>&w=1600" out.png --size 1600x<h> --scale 1
#    color-correction: food, recipe 1 (levels, curves, temperature, vibrance + sharpen)
#    black-and-white:  city, recipe 3 (grayscale mix, curves, clarity, grain, vignette)
#    portrait-retouch: portrait, recipe 2 (SAM skin copy + surfaceBlur, grade, vignette), face crop 640x700+460+180, w=1280
#    product-cutout:   product, `remove-bg photo --background "#ffffff" --shadow`, crop 700x700 at 769,121, w=1280
#                      (before = the same 700x700 crop of the original photo)

# 3. Diagrams and grids
#    node shot.mjs "file://$V/how-it-works.html?light" $A/how-it-works-light.png --size 1800x815 --scale 1   (and ?dark)
#    node shot.mjs "file://$V/social-preview.html?dir=<downsized showcases>" $A/social-preview.png --size 1280x640 --scale 1
#    node shot.mjs "file://$V/templates-grid.html?dir=<grid>" grid.png --size 1800x851 --scale 1 && magick grid.png -quality 85 $A/templates-grid.jpg

# 4. Studio screenshots: `ap studio --project <dir> --port <p> --no-open`, then
#    STEPS='[["wait",5000],["click",x,y],…,["shot"]]' node shot.mjs http://127.0.0.1:<p>/ out.png --size 1440x900 --scale 2 \
#      --storage '{"agentphoto.studio.lang":"en","agentphoto.studio.layersHeight":"190","agentphoto.studio.modelConsent.slimsam":"1"}' --steps steps.mjs
#    then magick out.png -resize 1600x -quality 85 $A/studio-<name>.jpg

# 5. showcase-loop.gif: wipes (before-after.html?mode=split driven by wipe.mjs, FRAMES=<dir>) and stills on a 1000x563 #0b0c10 canvas,
#    magick -delay … -loop 0 -layers Optimize +dither -colors 192
