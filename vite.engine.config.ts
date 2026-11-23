import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";

// The engine page bundle driven by headless Chrome (agent/render/):
//   dist/engine/agentphoto-engine.js  (+ chunks/: transformers.js, loaded only for AI)
//   dist/engine/ort/                  ONNX Runtime WebAssembly files (AI models)
// The Studio imports src/engine/ directly (its own build).

function copyOrt(): Plugin {
  return {
    name: "agentphoto-copy-ort",
    closeBundle() {
      const src = join("node_modules", "onnxruntime-web", "dist");
      const out = join("dist", "engine", "ort");
      if (!existsSync(src)) return;
      mkdirSync(out, { recursive: true });
      for (const f of readdirSync(src)) if (/^ort-wasm-simd-threaded\.asyncify\.(mjs|wasm)$/.test(f)) copyFileSync(join(src, f), join(out, f));
    },
  };
}

// ONNX Runtime without its WASM inlined (lib mode would base64 70 MB into the
// chunk): the .wasm files are copied next to the bundle and loaded from there.
export const ORT_ALIAS = { "onnxruntime-web/webgpu": join(process.cwd(), "node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs") };

export default defineConfig({
  publicDir: false,
  resolve: { alias: ORT_ALIAS },
  plugins: [copyOrt()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "dist/engine",
    emptyOutDir: true,
    target: "es2022",
    minify: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    modulePreload: false,
    lib: { entry: "src/engine/headless.ts", formats: ["es"], fileName: () => "agentphoto-engine.js" },
    rolldownOptions: { output: { format: "es", chunkFileNames: "chunks/[name]-[hash].js" } },
  },
});
