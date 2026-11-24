// Open a project or an image from a link, in local mode: #import=<ref>.
//
// <ref> is a same-origin URL ("/files/lake.agentphoto.json") or, when the
// host page configures `importUrl`, a path its server resolves
// ("out/lake.agentphoto.json"). A host serving the Studio next to an agent
// platform sets, in window.__AGENTPHOTO_CONFIG__ (config.js next to
// index.html, or at the root of a hosted dist/):
//   importUrl:           "/api/v1/sessions/{session}/workspace/raw?path={path}"
//   sessionFromReferrer: "/s/([^/?#]+)"   (the conversation the link came from)
// A public site hosting the Studio can also set guideUrl: { en, fr } (a
// "Guide" link on the start screen).
// {session} comes from #session=<id>, else from the referrer.
//
// A project travels as one JSON bundle (agentphoto bundle, see docs/studio.md):
//   { "format": "agentphoto-project", "version": 1, "title": "Lake",
//     "files": { "photo.json": "<base64>", "assets/images/lake.jpg": "<base64>", ... } }

export interface StudioConfig {
  importUrl?: string;
  sessionFromReferrer?: string;
  ortBase?: string;
  guideUrl?: { en?: string; fr?: string };
}

export interface ProjectBundle {
  title: string;
  files: Record<string, Uint8Array>;
}

export const BUNDLE_FORMAT = "agentphoto-project";
const MAX_FILES = 2000;

export class ImportError extends Error {
  constructor(
    readonly code: "noSession" | "badLink" | "fetch" | "badBundle" | "unsupported",
    message: string,
  ) {
    super(message);
  }
}

let cached: Promise<StudioConfig> | null = null;

const readConfig = (): StudioConfig | null => {
  const c = (window as unknown as { __AGENTPHOTO_CONFIG__?: unknown }).__AGENTPHOTO_CONFIG__;
  return c && typeof c === "object" ? (c as StudioConfig) : null;
};

const loadScript = (src: string): Promise<void> =>
  new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });

// config.js is optional: absent (404, or an SPA fallback page) means no
// config. Next to index.html; when the package's dist/ is hosted as is (the
// Studio in studio/), at the root of that site.
export function loadConfig(): Promise<StudioConfig> {
  cached ??= (async () => {
    await loadScript("./config.js");
    if (!readConfig() && /\/studio\/(index\.html)?$/.test(location.pathname)) await loadScript("../config.js");
    return readConfig() ?? {};
  })();
  return cached;
}

export function sessionOf(config: StudioConfig, explicit: string | null, referrer: string): string | null {
  if (explicit) return explicit;
  if (!config.sessionFromReferrer || !referrer) return null;
  try {
    const ref = new URL(referrer);
    const m = new RegExp(config.sessionFromReferrer).exec(ref.pathname + ref.search + ref.hash);
    return m?.[1] ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

// The URL to fetch for <ref>, always on the page's own origin.
export function resolveImport(ref: string, config: StudioConfig, session: string | null, pageUrl: string): string {
  const page = new URL(pageUrl);
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("/")) {
    const url = new URL(ref, page);
    if (url.origin !== page.origin) throw new ImportError("badLink", "The link points to another site.");
    return url.href;
  }
  if (!config.importUrl) throw new ImportError("badLink", "This Studio does not resolve file paths.");
  if (ref.split("/").some((p) => p === ".." || p === "")) throw new ImportError("badLink", `Bad path "${ref}".`);
  if (config.importUrl.includes("{session}") && !session) throw new ImportError("noSession", "No conversation for this link.");
  const url = new URL(
    config.importUrl.replace("{session}", encodeURIComponent(session ?? "")).replace("{path}", encodeURIComponent(ref)),
    page,
  );
  if (url.origin !== page.origin) throw new ImportError("badLink", "importUrl points to another site.");
  return url.href;
}

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function parseBundle(text: string): ProjectBundle {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ImportError("badBundle", "The file is not a project bundle (invalid JSON).");
  }
  const b = data as { format?: unknown; version?: unknown; title?: unknown; files?: unknown };
  if (b?.format !== BUNDLE_FORMAT || b.version !== 1 || !b.files || typeof b.files !== "object")
    throw new ImportError("badBundle", `Not an ${BUNDLE_FORMAT} version 1 bundle.`);
  const entries = Object.entries(b.files as Record<string, unknown>);
  if (entries.length > MAX_FILES) throw new ImportError("badBundle", "Too many files in the bundle.");
  const files: Record<string, Uint8Array> = {};
  for (const [path, value] of entries) {
    if (typeof value !== "string" || path.startsWith("/") || path.includes("\\") || path.split("/").some((p) => p === ".." || p === ""))
      throw new ImportError("badBundle", `Bad file "${path}" in the bundle.`);
    try {
      files[path] = fromBase64(value);
    } catch {
      throw new ImportError("badBundle", `File "${path}" is not base64.`);
    }
  }
  if (!files["photo.json"]) throw new ImportError("badBundle", "The bundle has no photo.json.");
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 200) : "Imported project";
  return { title, files };
}

// Stable id for a bundle: the same link opens the same stored project again
// (with the person's local edits) instead of a copy.
export async function bundleId(title: string, bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  const hex = [...digest.slice(0, 6)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
  return `import-${slug}-${hex}`;
}

export type Fetched = { kind: "bundle"; bytes: Uint8Array } | { kind: "image"; name: string; bytes: Uint8Array };

const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|bmp)$/i;

export function classify(ref: string, contentType: string, bytes: Uint8Array): Fetched {
  const name = decodeURIComponent(ref.split(/[?#]/)[0].split("/").pop() || "image");
  if (contentType.includes("json") || /\.json$/i.test(name) || bytes[0] === 0x7b) return { kind: "bundle", bytes };
  if (contentType.startsWith("image/") || IMAGE_EXT.test(name)) return { kind: "image", name, bytes };
  throw new ImportError("unsupported", "The link is neither a project bundle nor an image.");
}

export async function fetchImport(url: string, ref: string): Promise<Fetched> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin" });
  } catch {
    throw new ImportError("fetch", "The file could not be downloaded.");
  }
  if (!res.ok) throw new ImportError("fetch", `The file could not be downloaded (HTTP ${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("text/html")) throw new ImportError("fetch", "The link answered a page, not a file.");
  return classify(ref, type, new Uint8Array(await res.arrayBuffer()));
}
