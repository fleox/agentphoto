// Builds the public site www.photo-touch-up.fr into dist/site/ (site/README.md):
//   /                 the Studio (dist/studio, local mode) + SEO tags, config.js
//   /guide/, /fr/guide/  the guide pages (site/content/<lang>.mjs → site/render.mjs)
//   /site/            style, fonts, screenshots, video, Open Graph image
//   404.html, robots.txt, sitemap.xml, CNAME, .nojekyll
// Run after `vite build` (the standalone Studio, with ONNX Runtime in ort/):
//   npm run build:site
// The release workflow (.github/workflows/site.yml) pushes dist/site/ to the
// GitHub Pages repository fleox/photo-touch-up.fr.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { appHead, appNoscript, guidePage, LANGS, notFoundPage, SITE_URL } from "../site/render.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const studio = join(root, "dist", "studio");
const out = join(root, "dist", "site");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const fail = (msg) => {
  console.error(`[site] ${msg}`);
  process.exit(1);
};
if (!existsSync(join(studio, "index.html"))) fail("dist/studio is missing: run `vite build` first (npm run build:site does).");
if (!existsSync(join(studio, "ort")) || !readdirSync(join(studio, "ort")).some((f) => f.endsWith(".wasm")))
  fail("dist/studio/ort has no ONNX Runtime: build the standalone Studio (`vite build`, not `npm run build:studio`).");

rmSync(out, { recursive: true, force: true });
cpSync(studio, out, { recursive: true });

// The app at /: SEO tags, structured data, a no-JS fallback.
const indexFile = join(out, "index.html");
let index = readFileSync(indexFile, "utf8");
if (!/<title>[^<]*<\/title>/.test(index)) fail("dist/studio/index.html has no <title>.");
index = index.replace(/<title>[^<]*<\/title>/, appHead()).replace(/<body>/, `<body>\n    ${appNoscript()}`);
writeFileSync(indexFile, index);

// The Studio's config: a "Guide" link on its start screen (src/studio/lib/importLink.ts).
const guideUrl = Object.fromEntries(Object.entries(LANGS).map(([l, c]) => [l, c.path]));
writeFileSync(join(out, "config.js"), `window.__AGENTPHOTO_CONFIG__ = ${JSON.stringify({ guideUrl })};\n`);

// Static files under /site/.
const assets = join(root, ".github", "assets");
const siteDir = join(out, "site");
mkdirSync(join(siteDir, "fonts"), { recursive: true });
cpSync(join(root, "site", "style.css"), join(siteDir, "style.css"));
for (const w of [400, 600, 700, 800]) cpSync(join(root, "library", "fonts", "inter", `inter-latin-${w}-normal.woff2`), join(siteDir, "fonts", `inter-latin-${w}-normal.woff2`));
if (existsSync(join(root, "site", "img"))) cpSync(join(root, "site", "img"), join(siteDir, "img"), { recursive: true, filter: (src) => !src.endsWith(".DS_Store") });
cpSync(join(assets, "social-preview.png"), join(siteDir, "og.png"));
cpSync(join(assets, "how-it-works-dark.png"), join(siteDir, "how-it-works.png"));
cpSync(join(assets, "video-poster.jpg"), join(siteDir, "video-poster.jpg"));
cpSync(join(assets, "agentphoto-demo.mp4"), join(siteDir, "agentphoto-demo.mp4"));

// Every screenshot a guide uses must exist, for both languages (--draft: a
// build to take them from, site/README.md "Screenshots").
const missing = Object.values(LANGS).flatMap((c) =>
  [...new Set(["editor", ...c.features.items.map((f) => f.shot)])].filter((n) => !existsSync(join(root, "site", "img", c.lang, `${n}.jpg`))).map((n) => `site/img/${c.lang}/${n}.jpg`),
);
if (missing.length && !process.argv.includes("--draft")) fail(`missing screenshots: ${missing.join(", ")} (site/README.md "Screenshots").`);

// Guide pages.
for (const c of Object.values(LANGS)) {
  const dir = join(out, ...c.path.split("/").filter(Boolean));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), guidePage(c, { version: pkg.version }));
}
writeFileSync(join(out, "404.html"), notFoundPage());

// Crawlers and GitHub Pages.
const today = new Date().toISOString().slice(0, 10);
const guides = Object.values(LANGS);
const alternates = [...guides.map((c) => [c.lang, c.path]), ["x-default", LANGS.en.path]]
  .map(([l, p]) => `\n    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL}${p}"/>`)
  .join("");
const entries = [`  <url><loc>${SITE_URL}/</loc><lastmod>${today}</lastmod></url>`, ...guides.map((c) => `  <url><loc>${SITE_URL}${c.path}</loc><lastmod>${today}</lastmod>${alternates}\n  </url>`)];
writeFileSync(join(out, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
writeFileSync(
  join(out, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`,
);
writeFileSync(join(out, "CNAME"), `${new URL(SITE_URL).host}\n`);
writeFileSync(join(out, ".nojekyll"), "");

console.log(`[site] dist/site → ${SITE_URL} (AgentPhoto ${pkg.version})`);
