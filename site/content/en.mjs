// The English guide (www.photo-touch-up.fr/guide/). Same keys as fr.mjs
// (scripts/site.test.ts checks it). Every claim must be true of the Studio
// served by this site (local mode: projects in the browser, engine and AI in
// the page) — see .claude/skills/repo-presentation "Writing rules".

export default {
  lang: "en",
  path: "/guide/",
  title: "Free online photo editor with layers and local AI — AgentPhoto Studio",
  description:
    "Edit photos in your browser: layers, masks, background removal and Segment Anything selections that run on your computer, curves, 20 looks, text, templates and PNG / JPEG / WebP export. No account, no upload. Your AI agent can drive it too.",
  nav: { features: "Features", tasks: "How to", agents: "For AI agents", faq: "FAQ", open: "Open the editor", other: "Français", github: "GitHub" },
  hero: {
    kicker: "Free · No account · Nothing uploaded",
    title: "A real photo editor in your browser, with AI that runs on your computer.",
    lead: "Layers, masks, background removal, smart selections, curves, looks, text and templates. Your photos stay on your computer — and the same studio can be driven by your AI agent.",
    cta: "Open the editor",
    secondary: "Let an AI agent drive it",
    shot: "The AgentPhoto Studio editor: layers, inspector and a photo on the canvas",
  },
  why: {
    title: "A photo editor that respects your time and your photos.",
    items: [
      ["Free, no account", "Open the page and edit. No sign-up, no trial, no ads, no watermark on exports."],
      ["Your photos stay with you", "Photos and projects are stored in your browser. Editing and exports happen on your computer: nothing is uploaded."],
      ["AI on your computer", "Background removal and Segment Anything selections run in the page. The model downloads once, after you agree, then stays in your browser's cache."],
      ["Non-destructive", "Every edit is a layer, a filter, a mask or a setting you can change later. Your original photo is never modified."],
      ["What you see is what you export", "The preview and the export use the same engine, at full resolution."],
      ["Built for agents too", "The same studio is a command-line tool and an MCP server: Claude Code or any AI agent retouches photos and checks its own work."],
    ],
  },
  features: {
    title: "Everything you need for everyday photo work.",
    items: [
      { id: "layers", shot: "editor", title: "Layers, groups and blend modes", body: "Stack photos, text, shapes, fills and adjustment layers. Groups, 16 blend modes, opacity, clipping to the layer below, alignment and a precise transform panel (position, size, rotation, flip)." },
      { id: "selections", shot: "ai-select", title: "Selections and quick AI select", body: "Marquee, lasso and polygonal lasso, magic wand, and quick AI select: click the object, Alt-click to exclude, Segment Anything finds its outline. Turn a selection into a mask, a new layer, a fill or a masked adjustment." },
      { id: "cutout", shot: "cutout", title: "Background removal", body: "One click removes the background of a photo with a local model (RMBG-1.4, or MODNet for portraits). The result is an editable mask: refine it with the brush, add a new background, a shadow or a sticker outline." },
      { id: "filters", shot: "filters", title: "28 filters with live parameters", body: "Exposure, levels, curves with a curve editor, shadows / highlights, white balance, vibrance, hue / saturation, colour balance, blur, surface blur for smooth skin, sharpen, clarity, grain, vignette, and auto tone, contrast and colour. Each filter stays editable." },
      { id: "looks", shot: "looks", title: "20 looks in one click", body: "Black & white, noir, vintage, polaroid, cinema, film, matte, golden hour… with a strength slider, on one layer or on everything below an adjustment layer." },
      { id: "text", shot: "text", title: "Text, shapes and layer effects", body: "Editable text with 15 bundled fonts, gradients, label backgrounds and wrapping. Rectangles, ellipses, lines, polygons and stars. Drop shadow, outer glow, inner shadow, stroke and colour overlay." },
      { id: "templates", shot: "start", title: "Templates and social sizes", body: "Start from a photo, a sample, a blank canvas at a social size (Open Graph, square post, story, YouTube thumbnail, banners…) or one of 8 templates where your photo replaces the template's." },
      { id: "export", shot: "export", title: "Export PNG, JPEG and WebP", body: "Choose the format (AVIF too, where the browser can encode it), quality and size (original, a preset, a custom size or a scale), keep transparency or flatten it, and see the file before you download it." },
    ],
    more: "Also: brush, eraser and clone stamp (each stroke is a new file, your photo is untouched), crop, eyedropper, colour-range masks, gradient and shape masks, undo / redo, English and French interface.",
  },
  steps: {
    title: "Your first edit in three steps.",
    items: [
      ["Open the editor", "No install: it runs in Chrome, Edge, Firefox or Safari on a computer."],
      ["Drop your photo", "Or start from a sample photo, a social size or a template. It becomes a project saved in your browser."],
      ["Edit and export", "Adjust, cut out, add text, then Export: the file is saved to your Downloads."],
    ],
  },
  tasks: {
    title: "Common tasks, step by step.",
    items: [
      { title: "Remove a background", steps: ["Open your photo and select its layer.", "In Properties → Mask, choose the model and click Remove background (the first time, the model downloads once).", "Zoom on the edges; paint on the mask to fix a detail.", "Export as PNG or WebP to keep the transparency, or add a fill layer below as a new background."] },
      { title: "Select an object with AI", steps: ["Pick Quick AI select (Q) in the tool rail.", "Click the object; Alt-click what should be left out.", "Apply, then mask the layer, copy the object to a new layer or add a masked adjustment."] },
      { title: "Resize a photo for social media", steps: ["Click an empty area of the canvas to see the Canvas settings.", "Choose a preset (square post, story, Open Graph, YouTube…) and resize the canvas, or keep it and choose the size in Export.", "In Export, Cover crops to fill the size, Contain adds margins."] },
      { title: "Crop and straighten", steps: ["Pick the Crop tool (C), drag the handles or choose a ratio, then press Enter.", "To straighten, select the photo and set its rotation in Properties → Transform.", "Rotate the whole image by 90° or flip it in the Canvas settings."] },
      { title: "Fix colour and light", steps: ["Select the photo, open Filters.", "Click Auto enhance: it measures the photo and adds the corrections it needs. Or add exposure, white balance, curves or vibrance and tune them live.", "Hide a filter with its eye to compare; nothing is final until you export."] },
      { title: "Add text to an image", steps: ["Pick the Text tool (T) and click on the photo.", "Type, then choose the font, size, colour or gradient and alignment in Properties.", "Add a drop shadow or a stroke in Effects so it stays readable on any photo."] },
    ],
  },
  agents: {
    title: "The photo studio your AI agent can run.",
    lead: "This editor is the visual side of AgentPhoto, a command-line tool and MCP server for AI agents. Claude Code, Claude Desktop, Cursor or any MCP client opens your photo, edits the same non-destructive document, renders a preview, looks at it, fixes what it sees and exports — on your computer.",
    points: [
      "Ask in plain words: “remove the background of product.jpg and put it on white with a soft shadow”, “make a YouTube thumbnail from this photo with the title …”, “export this for Instagram, story and Open Graph”.",
      "The agent checks its work: every change is rendered headless and looked at before the next one.",
      "Then finish by hand: the agent opens the same project in this Studio, and changes appear live.",
    ],
    install: "In Claude Code:",
    other: "Other agents (MCP), the CLI and the Hermes Agent skills:",
    repo: "AgentPhoto on GitHub",
    npm: "npm package",
    video: "The 2-minute demo: an agent retouches, cuts out and designs, then the Studio.",
    videoLabel: "Watch the AgentPhoto demo",
  },
  faq: {
    title: "Good questions, honest answers.",
    items: [
      ["Is it really free?", "Yes. No account, no subscription, no ads and no watermark. AgentPhoto is source available on GitHub."],
      ["Are my photos uploaded to a server?", "No. Photos and projects are stored in your browser (IndexedDB) and every edit and export happens on your computer. The site only serves the editor's files. The network is used to download an AI model the first time you use it (from Hugging Face, after you agree) and, if you choose to use it, by the optional assistant, which sends your previews to Claude with your own API key."],
      ["Where are my projects saved?", "In this browser, on this computer. They are listed under Recent on the start screen. Clearing the site's data in your browser deletes them, so export what you want to keep."],
      ["How does background removal work without a server?", "The model runs in the page with WebAssembly. RMBG-1.4 (168 MB) is the default; MODNet (25 MB) is made for portraits. Both download once and stay in your browser's cache."],
      ["Can I use it for commercial work?", "Fonts and sample photos are free for commercial images. The default background-removal model, RMBG-1.4, is licensed for non-commercial use only: for commercial work use MODNet (people) or Segment Anything selections. AgentPhoto itself is licensed under PolyForm Noncommercial 1.0.0; commercial use of the software needs the author's authorization."],
      ["Which formats can I open and export?", "Open JPEG, PNG, WebP and the other images your browser can read. Export PNG, JPEG, WebP and AVIF (AVIF where the browser can encode it)."],
      ["Does it work on a phone?", "The editor is designed for a computer screen with a mouse or trackpad. Use a recent Chrome, Edge, Firefox or Safari."],
      ["What happened to Photo Touch-Up?", "Photo Touch-Up, the editor that used to live at this address, became AgentPhoto: a new engine with non-destructive layers, local AI and templates, which AI agents can also drive."],
    ],
  },
  final: { title: "Edit your next photo now.", cta: "Open the editor", note: "Nothing to install, nothing uploaded." },
  footer: {
    made: "AgentPhoto — the photo studio your AI agent can run.",
    licence: "Source available under PolyForm Noncommercial 1.0.0.",
    links: { editor: "Editor", guide: "Guide", github: "GitHub", npm: "npm", docs: "Documentation", privacy: "Privacy" },
  },
  notFound: { title: "Page not found", body: "This page does not exist (any more).", editor: "Open the editor", guide: "Read the guide" },
  app: {
    title: "AgentPhoto Studio — free online photo editor with local AI",
    description:
      "Free photo editor in your browser: layers, masks, background removal and AI selections that run on your computer, curves, looks, text, templates. No account, nothing uploaded.",
    noscript: "AgentPhoto Studio needs JavaScript. Read the guide:",
  },
};
