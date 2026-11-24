// HTML for the public site's own pages (guide, 404) and the <head> added to
// the Studio's index.html. Pure functions over site/content/<lang>.mjs; the
// files are written by scripts/build-site.mjs.

import en from "./content/en.mjs";
import fr from "./content/fr.mjs";

export const SITE_URL = "https://www.photo-touch-up.fr";
export const REPO_URL = "https://github.com/fleox/agentphoto";
export const NPM_URL = "https://www.npmjs.com/package/@fleox/agentphoto";
export const LANGS = { en, fr };
// Google Analytics on every page of the public site (the owner's choice; the
// npm package's Studio and the CLI have none). docs/security.md says so.
export const GA_ID = "G-JE88WG1Z5R";

export function analytics() {
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
    <script>window.dataLayer = window.dataLayer || []; function gtag(){dataLayer.push(arguments);} gtag("js", new Date()); gtag("config", "${GA_ID}");</script>`;
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const json = (v) => JSON.stringify(v).replace(/</g, "\\u003c");
const other = (c) => (c.lang === "en" ? fr : en);

// Screenshots: site/img/<lang>/<name>.jpg (1600×1000, captured from this site).
const shot = (c, name, alt, attrs = "") =>
  `<img src="/site/img/${c.lang}/${name}.jpg" width="1600" height="1000" alt="${esc(alt)}" ${attrs}>`;

const icon = {
  github: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
  arrow: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M3 8h10M9 4l4 4-4 4"/></svg>',
};

export const LOGO =
  '<svg class="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2a30"/><stop offset="1" stop-color="#0c0c0f"/></linearGradient><linearGradient id="ld" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7aa5ff"/><stop offset="1" stop-color="#3d6bff"/></linearGradient></defs><rect width="32" height="32" rx="7.5" fill="url(#lg)"/><rect x="7" y="9" width="18" height="14" rx="2.5" fill="none" stroke="#fff" stroke-width="2.2"/><path d="M9 21l5-5 3 3 2.5-2.5L23 20" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><circle cx="20.5" cy="13.5" r="2" fill="url(#ld)"/></svg>';

const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%232a2a30'/%3E%3Cstop offset='1' stop-color='%230c0c0f'/%3E%3C/linearGradient%3E%3ClinearGradient id='d' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%237aa5ff'/%3E%3Cstop offset='1' stop-color='%233d6bff'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='7.5' fill='url(%23g)'/%3E%3Crect x='7' y='9' width='18' height='14' rx='2.5' fill='none' stroke='%23fff' stroke-width='2.2'/%3E%3Cpath d='M9 21l5-5 3 3 2.5-2.5L23 20' fill='none' stroke='%23fff' stroke-width='1.8' stroke-linejoin='round'/%3E%3Ccircle cx='20.5' cy='13.5' r='2' fill='url(%23d)'/%3E%3C/svg%3E";

// Shared <head> tags: description, canonical, hreflang, Open Graph, Twitter.
function metaTags({ title, description, url, lang, alternates }) {
  const og = `${SITE_URL}/site/og.png`;
  return [
    `<meta name="description" content="${esc(description)}">`,
    `<link rel="canonical" href="${url}">`,
    ...(alternates ?? []).map(([l, href]) => `<link rel="alternate" hreflang="${l}" href="${href}">`),
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="AgentPhoto">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${og}">`,
    `<meta property="og:image:width" content="1280">`,
    `<meta property="og:image:height" content="640">`,
    `<meta property="og:locale" content="${lang === "fr" ? "fr_FR" : "en_US"}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:image" content="${og}">`,
  ].join("\n    ");
}

const guideAlternates = () => [
  ["en", `${SITE_URL}${en.path}`],
  ["fr", `${SITE_URL}${fr.path}`],
  ["x-default", `${SITE_URL}${en.path}`],
];

function appJsonLd(c) {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "AgentPhoto Studio",
    url: `${SITE_URL}/`,
    description: c.app.description,
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "Photo editor",
    operatingSystem: "Any (modern browser on a computer)",
    browserRequirements: "Requires JavaScript and WebAssembly.",
    inLanguage: ["en", "fr"],
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    sameAs: [REPO_URL, NPM_URL],
    featureList: c.features.items.map((f) => f.title),
  };
}

// Tags added to the Studio's index.html (the app at /).
export function appHead() {
  const c = en;
  return [
    `<title>${esc(c.app.title)}</title>`,
    analytics(),
    metaTags({ title: c.app.title, description: c.app.description, url: `${SITE_URL}/`, lang: "en" }),
    `<script type="application/ld+json">${json(appJsonLd(c))}</script>`,
  ].join("\n    ");
}

export function appNoscript() {
  return `<noscript><p style="font:16px system-ui;color:#e4e7ec;padding:24px">${esc(en.app.noscript)} <a style="color:#7c8cff" href="${en.path}">${esc(en.footer.links.guide)}</a> · <a style="color:#7c8cff" href="${fr.path}" hreflang="fr">${esc(fr.footer.links.guide)} (FR)</a></p></noscript>`;
}

function header(c) {
  const o = other(c);
  return `<header class="site">
  <div class="wrap">
    <a class="brand" href="${c.path}">${LOGO}<span>AgentPhoto</span></a>
    <nav aria-label="${esc(c.nav.features)}">
      <a href="#features">${esc(c.nav.features)}</a>
      <a href="#tasks">${esc(c.nav.tasks)}</a>
      <a href="#agents">${esc(c.nav.agents)}</a>
      <a href="#faq">${esc(c.nav.faq)}</a>
    </nav>
    <div class="actions">
      <a class="lang" href="${o.path}" hreflang="${o.lang}" lang="${o.lang}">${esc(c.nav.other)}</a>
      <a class="gh" href="${REPO_URL}" aria-label="${esc(c.nav.github)}">${icon.github}</a>
      <a class="btn btn-primary btn-sm" href="/?lang=${c.lang}">${esc(c.nav.open)}</a>
    </div>
  </div>
</header>`;
}

function footer(c) {
  const l = c.footer.links;
  return `<footer class="site">
  <div class="wrap">
    <div class="foot-brand">${LOGO}<div><strong>${esc(c.footer.made)}</strong><br><span>${esc(c.footer.licence)}</span></div></div>
    <nav>
      <a href="/?lang=${c.lang}">${esc(l.editor)}</a>
      <a href="${c.path}">${esc(l.guide)}</a>
      <a href="${REPO_URL}">${esc(l.github)}</a>
      <a href="${NPM_URL}">${esc(l.npm)}</a>
      <a href="${REPO_URL}/tree/main/docs">${esc(l.docs)}</a>
      <a href="${REPO_URL}/blob/main/docs/security.md">${esc(l.privacy)}</a>
      <a href="${other(c).path}" hreflang="${other(c).lang}">${esc(c.nav.other)}</a>
    </nav>
  </div>
</footer>`;
}

function page(c, { title, description, url, alternates, body, jsonLd = [] }) {
  return `<!doctype html>
<html lang="${c.lang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    ${analytics()}
    <title>${esc(title)}</title>
    ${metaTags({ title, description, url, lang: c.lang, alternates })}
    <link rel="icon" href="${FAVICON}">
    <link rel="preload" href="/site/fonts/inter-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="/site/style.css">
    ${jsonLd.map((j) => `<script type="application/ld+json">${json(j)}</script>`).join("\n    ")}
  </head>
  <body>
${header(c)}
${body}
${footer(c)}
  </body>
</html>
`;
}

const INSTALL = ["/plugin marketplace add fleox/agentphoto", "/plugin install agentphoto@agentphoto"];

export function guidePage(c, { version }) {
  const url = `${SITE_URL}${c.path}`;
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faq.items.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "AgentPhoto Studio", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: c.footer.links.guide, item: url },
    ],
  };
  const howTo = c.tasks.items.map((t) => ({
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: t.title,
    step: t.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, text: s })),
  }));
  const body = `<main>
  <section class="hero">
    <div class="wrap">
      <p class="kicker">${esc(c.hero.kicker)}</p>
      <h1>${esc(c.hero.title)}</h1>
      <p class="lead">${esc(c.hero.lead)}</p>
      <div class="cta">
        <a class="btn btn-primary" href="/?lang=${c.lang}">${esc(c.hero.cta)} ${icon.arrow}</a>
        <a class="btn btn-ghost" href="#agents">${esc(c.hero.secondary)}</a>
      </div>
      <figure class="frame hero-shot">${shot(c, "editor", c.hero.shot, 'fetchpriority="high"')}</figure>
    </div>
  </section>

  <section class="why">
    <div class="wrap">
      <h2>${esc(c.why.title)}</h2>
      <div class="grid3">
        ${c.why.items.map(([h, p]) => `<div class="card"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join("\n        ")}
      </div>
    </div>
  </section>

  <section id="features" class="features">
    <div class="wrap">
      <h2>${esc(c.features.title)}</h2>
      ${c.features.items
        .map(
          (f, i) => `<article class="feature${i % 2 ? " flip" : ""}" id="${f.id}">
        <div class="text"><h3>${esc(f.title)}</h3><p>${esc(f.body)}</p></div>
        <figure class="frame">${shot(c, f.shot, f.title, 'loading="lazy" decoding="async"')}</figure>
      </article>`,
        )
        .join("\n      ")}
      <p class="more">${esc(c.features.more)}</p>
    </div>
  </section>

  <section class="steps">
    <div class="wrap">
      <h2>${esc(c.steps.title)}</h2>
      <ol class="grid3">
        ${c.steps.items.map(([h, p]) => `<li class="card"><h3>${esc(h)}</h3><p>${esc(p)}</p></li>`).join("\n        ")}
      </ol>
    </div>
  </section>

  <section id="tasks" class="tasks">
    <div class="wrap">
      <h2>${esc(c.tasks.title)}</h2>
      <div class="grid2">
        ${c.tasks.items.map((t) => `<div class="card"><h3>${esc(t.title)}</h3><ol>${t.steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol></div>`).join("\n        ")}
      </div>
    </div>
  </section>

  <section id="agents" class="agents">
    <div class="wrap">
      <h2>${esc(c.agents.title)}</h2>
      <p class="lead">${esc(c.agents.lead)}</p>
      <div class="agents-grid">
        <div>
          <ul class="points">${c.agents.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
          <p class="label">${esc(c.agents.install)}</p>
          <pre><code>${INSTALL.map(esc).join("\n")}</code></pre>
          <p class="label">${esc(c.agents.other)}</p>
          <pre><code>npx -y @fleox/agentphoto@${esc(version)} mcp</code></pre>
          <div class="cta">
            <a class="btn btn-primary" href="${REPO_URL}">${icon.github} ${esc(c.agents.repo)}</a>
            <a class="btn btn-ghost" href="${NPM_URL}">${esc(c.agents.npm)}</a>
          </div>
        </div>
        <figure class="frame video">
          <video controls preload="none" playsinline poster="/site/video-poster.jpg" aria-label="${esc(c.agents.videoLabel)}">
            <source src="/site/agentphoto-demo.mp4" type="video/mp4">
          </video>
          <figcaption>${esc(c.agents.video)}</figcaption>
        </figure>
      </div>
      <figure class="diagram"><img src="/site/how-it-works.png" width="1800" height="815" alt="" loading="lazy" decoding="async"></figure>
    </div>
  </section>

  <section id="faq" class="faq">
    <div class="wrap narrow">
      <h2>${esc(c.faq.title)}</h2>
      ${c.faq.items.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n      ")}
    </div>
  </section>

  <section class="final">
    <div class="wrap">
      <h2>${esc(c.final.title)}</h2>
      <a class="btn btn-primary" href="/?lang=${c.lang}">${esc(c.final.cta)} ${icon.arrow}</a>
      <p>${esc(c.final.note)}</p>
    </div>
  </section>
</main>`;
  return page(c, { title: c.title, description: c.description, url, alternates: guideAlternates(), body, jsonLd: [crumbs, faqLd, ...howTo] });
}

export function notFoundPage() {
  const c = en;
  const body = `<main class="notfound"><div class="wrap narrow">
  <h1>${esc(c.notFound.title)} · ${esc(fr.notFound.title)}</h1>
  <p>${esc(c.notFound.body)}<br>${esc(fr.notFound.body)}</p>
  <div class="cta"><a class="btn btn-primary" href="/">${esc(c.notFound.editor)}</a><a class="btn btn-ghost" href="${en.path}">${esc(c.notFound.guide)}</a><a class="btn btn-ghost" href="${fr.path}">${esc(fr.notFound.guide)}</a></div>
</div></main>`;
  return page(c, { title: `${c.notFound.title} — AgentPhoto`, description: c.app.description, url: `${SITE_URL}/404.html`, body }).replace(
    "<head>",
    '<head>\n    <meta name="robots" content="noindex">',
  );
}
