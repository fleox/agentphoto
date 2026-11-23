import { defineConfig } from "vite";

// Builds the `agentphoto` CLI (agent/bin.ts) into ONE self-contained Node
// entry, dist/agent/agentphoto.mjs (+ lazy chunks) — every dependency is
// inlined so the npm package needs no runtime dependencies (mirror of
// agent-3d's vite.agent.config.ts). The CLI never runs the engine itself
// (headless Chrome does, from dist/engine): transformers.js / ONNX Runtime
// must never end up in this bundle — the guard below fails the build if
// they do.
const CJS_SHIM = [
  'import { createRequire as __apRequire } from "node:module";',
  'import { fileURLToPath as __apPath } from "node:url";',
  'import { dirname as __apDirname } from "node:path";',
  "const require = __apRequire(import.meta.url);",
  "const __filename = __apPath(import.meta.url);",
  "const __dirname = __apDirname(__filename);",
].join("\n");

// Raw U+2028 / U+2029 characters are line terminators inside a regex
// literal (a syntax error for the bundler's parser). Escaping them as
// \u2028 / \u2029 means the same thing in regexes, strings, templates and
// comments, so do it for every source module before transforming.
const escapeLineSeparators = {
  name: "agentphoto-escape-line-separators",
  enforce: "pre" as const,
  transform(code: string) {
    if (!/[\u2028\u2029]/.test(code)) return null;
    return { code: code.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029"), map: null };
  },
};

const FORBIDDEN = /[\\/]node_modules[\\/](@huggingface[\\/]transformers|onnxruntime-(web|node|common))[\\/]|[\\/]src[\\/]engine[\\/]ai\.ts$/;
const noEngineDeps = {
  name: "agentphoto-no-engine-deps",
  load(id: string) {
    if (FORBIDDEN.test(id)) throw new Error(`The CLI bundle must not include ${id} (the engine runs in headless Chrome from dist/engine): import types only.`);
    return null;
  },
};

export default defineConfig({
  plugins: [escapeLineSeparators, noEngineDeps],
  // public/ belongs to the Studio build — keep it out of dist/agent/.
  publicDir: false,
  define: {
    __AGENTPHOTO_BUNDLED__: "true",
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  ssr: {
    noExternal: true,
  },
  build: {
    ssr: "agent/bin.ts",
    target: "node22",
    outDir: "dist/agent",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "agentphoto.mjs",
        // Commands load their modules on demand, so `help` / `version` start instantly.
        chunkFileNames: "chunks/[name]-[hash].mjs",
        banner: (chunk) => (chunk.isEntry ? "#!/usr/bin/env node\n" : "") + CJS_SHIM,
      },
    },
  },
});
