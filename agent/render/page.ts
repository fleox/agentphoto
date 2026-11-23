import type { LibraryIndex } from "../../src/core/library";

// The page headless Chrome loads (served at /__engine.html by the engine
// session's local server): imports the engine bundle (dist/engine →
// /__engine/), initialises window.agentphoto (src/engine/headless.ts) with
// the project at /project/, the library at /__library/ and the AI model
// cache proxy at /__models/, then flags itself ready. AI progress events are
// console.log'ed with a tag the session forwards to stderr.

export const ENGINE_PAGE = "/__engine.html";
export const PROGRESS_TAG = "[agentphoto:progress]";

export function enginePageHtml(opts: { library: LibraryIndex; engineUrl?: string; assetBase?: string; libraryBase?: string; modelsBase?: string; wasmPaths?: string }): string {
  // JSON inside <script>: "<" escaped so "</script>" in a description cannot end the block.
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>AgentPhoto engine</title></head>
<body><script type="module">
try {
  await import(${json(opts.engineUrl ?? "/__engine/agentphoto-engine.js")});
  const ai = {
    remoteHost: location.origin + ${json(opts.modelsBase ?? "/__models/")},
    wasmPaths: ${json(opts.wasmPaths ?? "/__engine/ort/")},
    onProgress: (p) => console.log(${json(PROGRESS_TAG)} + " " + JSON.stringify(p)),
  };
  await window.agentphoto.init({ assetBase: ${json(opts.assetBase ?? "/project/")}, libraryBase: ${json(opts.libraryBase ?? "/__library/")}, library: ${json(opts.library)}, ai });
  window.__agentphotoReady = true;
} catch (e) {
  window.__agentphotoError = String((e && e.stack) || e);
}
</script></body></html>
`;
}
