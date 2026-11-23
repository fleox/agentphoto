import { copyFileSync, cpSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
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
//   library/   bundled fonts + sample photos (copied from the repo's library/)
//   ort/       ONNX Runtime WebAssembly (AI models run in the page)
// The dev server serves both from the repo (library/ is under the root;
// /ort/ is mapped to node_modules/onnxruntime-web/dist).
const api = process.env.AGENTPHOTO_STUDIO_API;
const ORT_DIR = join("node_modules", "onnxruntime-web", "dist");
// ort.webgpu.min.mjs (ORT_ALIAS) picks a build at run time (JSEP with WebGPU,
// asyncify / JSPI without): ship them all, like vite.engine.config.ts.
const ORT_FILE = /^ort-wasm-simd-threaded(\.[a-z]+)?\.(mjs|wasm)$/;

function studioFiles(): Plugin {
  return {
    name: "agentphoto-studio-files",
    configurePreviewServer(server) {
      // No CLI behind `vite preview`: answer the Studio's API probe (local mode) without a 404.
      server.middlewares.use("/api/info", (_req, res) => void res.writeHead(204).end());
    },
    configureServer(server) {
      if (!api) server.middlewares.use("/api/info", (_req, res) => void res.writeHead(204).end());
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
      if (existsSync(ORT_DIR)) {
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
