import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { ORT_ALIAS } from "./vite.engine.config.ts";

// The Studio SPA (src/studio/) → dist/studio/, served by `agentphoto studio`
// (relative base so it also works from any static folder).
// `npm run dev` runs it without the CLI (in-browser projects); set
// AGENTPHOTO_STUDIO_API=http://127.0.0.1:4331 to proxy a running `agentphoto studio`.
//
// In-browser projects (local mode) need, next to index.html:
//   library/    bundled fonts + sample photos (copied from the repo's library/)
//   templates/  starter templates + templates/index.json (each template.json + its file list)
//   ort/        ONNX Runtime WebAssembly (AI models run in the page)
// The dev server serves them from the repo (library/ and templates/ are under
// the root, templates/index.json is generated, /ort/ maps to
// node_modules/onnxruntime-web/dist). Served by the CLI (remote mode), the
// Studio loads ONNX Runtime from the CLI's /__engine/ort/ instead.
//
// ONNX Runtime: the engine aliases onnxruntime-web/webgpu to
// ort.webgpu.min.mjs (ORT_ALIAS). That build only ever loads
// ort-wasm-simd-threaded.asyncify.{mjs,wasm} (WebGPU or not — checked in its
// source), so that pair (~26 MB) is the only one shipped here; the other
// variants (jsep, jspi, plain) are never requested. Set STUDIO_NO_ORT=1 to
// skip it entirely (Studio only ever served by the CLI).
const api = process.env.AGENTPHOTO_STUDIO_API;
const ORT_DIR = join("node_modules", "onnxruntime-web", "dist");
const ORT_FILE = /^ort-wasm-simd-threaded\.asyncify\.(mjs|wasm)$/;

// templates/index.json: [{ ...template.json, files: [paths inside the template] }].
function templatesIndex(root = "templates"): unknown[] {
  if (!existsSync(root)) return [];
  const walk = (dir: string, rel = ""): string[] => readdirSync(dir).flatMap((f) => (f === ".DS_Store" ? [] : statSync(join(dir, f)).isDirectory() ? walk(join(dir, f), `${rel}${f}/`) : [`${rel}${f}`]));
  return readdirSync(root)
    .filter((id) => existsSync(join(root, id, "template.json")))
    .map((id) => ({ id, ...JSON.parse(readFileSync(join(root, id, "template.json"), "utf8")), files: walk(join(root, id)) }));
}

function studioFiles(): Plugin {
  return {
    name: "agentphoto-studio-files",
    configurePreviewServer(server) {
      // No CLI behind `vite preview`: answer the Studio's API probe (local mode) without a 404.
      server.middlewares.use("/api/info", (_req, res) => void res.writeHead(204).end());
    },
    configureServer(server) {
      if (!api) server.middlewares.use("/api/info", (_req, res) => void res.writeHead(204).end());
      server.middlewares.use("/templates/index.json", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(templatesIndex()));
      });
      server.middlewares.use("/ort/", (req, res, next) => {
        const name = decodeURIComponent((req.url ?? "").split("?")[0].replace(/^\//, ""));
        const file = join(ORT_DIR, name);
        if (!ORT_FILE.test(name) || !existsSync(file)) return next();
        res.setHeader("content-type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript");
        res.setHeader("content-length", String(statSync(file).size));
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      const out = join("dist", "studio");
      if (!existsSync(out)) return;
      if (existsSync("library")) cpSync("library", join(out, "library"), { recursive: true, filter: (src) => !src.endsWith(".DS_Store") });
      if (existsSync("templates")) {
        cpSync("templates", join(out, "templates"), { recursive: true, filter: (src) => !src.endsWith(".DS_Store") });
        writeFileSync(join(out, "templates", "index.json"), JSON.stringify(templatesIndex()));
      }
      if (existsSync(ORT_DIR) && !process.env.STUDIO_NO_ORT) {
        mkdirSync(join(out, "ort"), { recursive: true });
        for (const f of readdirSync(ORT_DIR)) if (ORT_FILE.test(f)) copyFileSync(join(ORT_DIR, f), join(out, "ort", f));
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), studioFiles()],
  publicDir: false,
  resolve: { alias: ORT_ALIAS },
  server: api ? { proxy: Object.fromEntries(["/api", "/__library", "/__engine", "/__models", "/project"].map((p) => [p, { target: api, changeOrigin: true }])) } : undefined,
  build: {
    outDir: "dist/studio",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
});
