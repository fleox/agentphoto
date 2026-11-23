import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "../testing/tmp";
import { cacheFileOf, listCachedModels, modelsRoute, parseModelPath } from "./models";
import { startLocalServer, type LocalServer } from "./server";

// The /__models/ cache proxy with an injected fetch: no network.

let root = "";
let server: LocalServer;
const fetched: string[] = [];
const FILES: Record<string, string> = {
  "https://hf.test/briaai/RMBG-1.4/resolve/main/config.json": '{"model_type":"custom"}',
  "https://hf.test/briaai/RMBG-1.4/resolve/main/onnx/model.onnx": "x".repeat(100_000),
};

beforeAll(async () => {
  root = tempDir("agentphoto-models-");
  const fetchImpl = async (url: string) => {
    fetched.push(url);
    await new Promise((r) => setTimeout(r, 20));
    const body = FILES[url];
    return body === undefined ? new Response("Entry not found", { status: 404 }) : new Response(body, { status: 200, headers: { "content-length": String(Buffer.byteLength(body)) } });
  };
  server = await startLocalServer({ mounts: {}, routes: [modelsRoute({ root: () => root, fetchImpl, upstream: "https://hf.test/" })] });
});
afterAll(() => server.close());

const get = async (path: string) => {
  const r = await fetch(`${server.url}${path}`);
  return { status: r.status, body: await r.text(), type: r.headers.get("content-type") };
};

describe("model cache proxy", () => {
  it("parses model paths and refuses traversal", () => {
    expect(parseModelPath("/__models/briaai/RMBG-1.4/resolve/main/onnx/model.onnx")).toEqual({ repo: "briaai/RMBG-1.4", rev: "main", file: "onnx/model.onnx" });
    expect(parseModelPath("/__models/a/resolve/main/x.json")).toEqual({ repo: "a", rev: "main", file: "x.json" });
    for (const bad of ["/__models/../resolve/main/x", "/__models/a/b/resolve/main/..%2f..%2fx", "/__models/a/b/main/x.json", "/__models/resolve/main/x"]) expect(parseModelPath(bad), bad).toBeNull();
    expect(cacheFileOf("/c", { repo: "a/b", rev: "main", file: "onnx/m.onnx" })).toBe("/c/a/b/main/onnx/m.onnx");
  });

  it("downloads once, then serves from the cache", async () => {
    const first = await get("/__models/briaai/RMBG-1.4/resolve/main/config.json");
    expect(first).toMatchObject({ status: 200, body: '{"model_type":"custom"}' });
    expect(first.type).toContain("application/json");
    // The response can complete a moment before the temp file is renamed.
    const cached = join(root, "briaai", "RMBG-1.4", "main", "config.json");
    for (let i = 0; i < 50 && !existsSync(cached); i++) await new Promise((r) => setTimeout(r, 10));
    expect(readFileSync(cached, "utf8")).toBe('{"model_type":"custom"}');
    const n = fetched.length;
    expect((await get("/__models/briaai/RMBG-1.4/resolve/main/config.json")).body).toBe('{"model_type":"custom"}');
    expect(fetched.length).toBe(n);
  });

  it("shares a download between concurrent requests and leaves no temp file", async () => {
    const [a, b] = await Promise.all([get("/__models/briaai/RMBG-1.4/resolve/main/onnx/model.onnx"), get("/__models/briaai/RMBG-1.4/resolve/main/onnx/model.onnx")]);
    expect(a.body.length).toBe(100_000);
    expect(b.body.length).toBe(100_000);
    expect(fetched.filter((u) => u.endsWith("model.onnx"))).toHaveLength(1);
    const dir = join(root, "briaai", "RMBG-1.4", "main", "onnx");
    for (let i = 0; i < 50 && !existsSync(join(dir, "model.onnx")); i++) await new Promise((r) => setTimeout(r, 10));
    expect(existsSync(join(dir, "model.onnx"))).toBe(true);
    expect(readdirSync(dir)).toEqual(["model.onnx"]);
  });

  it("passes 404s through without caching", async () => {
    expect((await get("/__models/briaai/RMBG-1.4/resolve/main/onnx/model.onnx_data")).status).toBe(404);
    expect(existsSync(join(root, "briaai", "RMBG-1.4", "main", "onnx", "model.onnx_data"))).toBe(false);
    expect((await get("/__models/not-a-model-path")).status).toBe(404);
  });

  it("lists cached models with their size", () => {
    const other = tempDir("agentphoto-models-list-");
    mkdirSync(join(other, "Xenova", "modnet", "main"), { recursive: true });
    writeFileSync(join(other, "Xenova", "modnet", "main", "config.json"), "{}");
    const list = listCachedModels(other);
    expect(list.find((m) => m.id === "modnet")).toMatchObject({ cached: true, files: 1 });
    expect(list.find((m) => m.id === "rmbg-1.4")).toMatchObject({ cached: false, files: 0 });
  });
});
