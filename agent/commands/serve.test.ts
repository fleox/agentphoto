import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "../testing/tmp";
import { startStudioServer, type StudioServer } from "./serve";

function http(port: number, method: string, path: string, opts: { headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string; type: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...opts.headers } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, type: String(res.headers["content-type"] ?? "") }));
    });
    req.on("error", reject);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

// Collects SSE frames until `until` matches (or times out).
function sse(port: number, path: string, until: (text: string) => boolean, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = "";
    const req = request({ host: "127.0.0.1", port, path, headers: { host: `127.0.0.1:${port}` } }, (res) => {
      res.on("data", (c) => {
        text += c;
        if (until(text)) {
          req.destroy();
          resolve(text);
        }
      });
    });
    req.on("error", (e) => (until(text) ? resolve(text) : reject(e)));
    setTimeout(() => {
      req.destroy();
      resolve(text);
    }, timeoutMs);
    req.end();
  });
}

const call = (port: number, name: string, input: unknown = {}) => http(port, "POST", "/api/tools/call", { headers: { "content-type": "application/json" }, body: JSON.stringify({ name, input }) });

let root = "";
let project = "";
let studio: StudioServer;

beforeAll(async () => {
  root = tempDir("agentphoto-studio-");
  project = join(root, "project");
  mkdirSync(join(root, "studio"), { recursive: true });
  mkdirSync(project, { recursive: true });
  writeFileSync(join(root, "studio", "index.html"), "<!doctype html><title>Studio</title>");
  writeFileSync(join(root, "secret.txt"), "secret");
  studio = await startStudioServer({ project, studioRoot: join(root, "studio") });
  const r = JSON.parse((await call(studio.port, "project_create", { name: "p", title: "Hello", size: "square" })).body);
  if (!r.ok) throw new Error(JSON.stringify(r));
});
afterAll(async () => {
  await studio.stop();
});

describe("studio API", () => {
  it("serves the SPA and the project info", async () => {
    expect((await http(studio.port, "GET", "/")).body).toContain("<title>Studio</title>");
    expect((await http(studio.port, "GET", "/some/route")).body).toContain("<title>Studio</title>");
    const info = JSON.parse((await http(studio.port, "GET", "/api/info")).body);
    expect(info).toMatchObject({ ok: true, data: { version: expect.any(String), project: { dir: project, exists: true, manifest: { name: "p" } }, assetBase: "/project/", libraryBase: "/__library/", engineBase: "/__engine/", modelsBase: "/__models/" } });
    expect(JSON.parse((await http(studio.port, "GET", "/api/catalog")).body).data.filters.length).toBeGreaterThan(10);
    expect(JSON.parse((await http(studio.port, "GET", "/api/library")).body).data.assets.length).toBeGreaterThan(0);
    expect(JSON.parse((await http(studio.port, "GET", "/api/templates")).body).data.templates).toEqual(expect.any(Array));
    expect((await http(studio.port, "GET", "/project/photo.json")).status).toBe(200);
    expect((await http(studio.port, "GET", "/__library/index.json")).status).toBe(200);
  });

  it("reads, writes, lists and deletes project files", async () => {
    expect((await http(studio.port, "PUT", "/api/project/assets/edits/a.txt", { body: "hello" })).status).toBe(200);
    const got = await http(studio.port, "GET", "/api/project/assets/edits/a.txt");
    expect([got.status, got.body]).toEqual([200, "hello"]);
    const list = JSON.parse((await http(studio.port, "GET", "/api/project")).body);
    expect(list.data.files.map((f: { path: string }) => f.path)).toEqual(expect.arrayContaining(["agentphoto.json", "photo.json", "assets/edits/a.txt"]));
    expect(JSON.parse((await http(studio.port, "GET", "/api/project?prefix=assets/")).body).data.files.map((f: { path: string }) => f.path).filter((p: string) => !p.startsWith("assets/") ).length).toBe(0);
    expect(JSON.parse((await http(studio.port, "DELETE", "/api/project/assets/edits/a.txt")).body)).toMatchObject({ ok: true });
    expect((await http(studio.port, "GET", "/api/project/assets/edits/a.txt")).status).toBe(404);
    expect((await http(studio.port, "DELETE", "/api/project/nope.txt")).status).toBe(404);
  });

  it("refuses paths outside the project and foreign hosts / origins", async () => {
    for (const p of ["/api/project/..%2fsecret.txt", "/api/project/%2e%2e/secret.txt", "/api/project/../secret.txt", "/project/../secret.txt"]) {
      const r = await http(studio.port, "GET", p);
      expect(r.body).not.toBe("secret");
      expect([400, 404]).toContain(r.status);
    }
    expect((await http(studio.port, "PUT", "/api/project/..%2fevil.txt", { body: "x" })).status).toBe(400);
    expect((await http(studio.port, "GET", "/api/info", { headers: { host: "evil.example:80" } })).status).toBe(403);
    expect((await http(studio.port, "PUT", "/api/project/x.txt", { headers: { origin: "https://evil.example" }, body: "x" })).status).toBe(403);
    expect((await http(studio.port, "GET", "/api/info", { headers: { origin: `http://localhost:${studio.port}` } })).status).toBe(200);
  });

  it("runs AI tools through POST /api/tools/call", async () => {
    const tools = JSON.parse((await http(studio.port, "GET", "/api/tools")).body);
    expect(tools.data.tools.map((t: { name: string }) => t.name)).toEqual(expect.arrayContaining(["doc_validate", "render_preview", "remove_background"]));
    const r = JSON.parse((await call(studio.port, "layer_add", { layer: { id: "bg", type: "fill", fill: "#102030" } })).body);
    expect(r).toMatchObject({ ok: true, data: { status: "applied" } });
    const bad = await call(studio.port, "nope");
    expect(bad.status).toBe(404);
    expect(JSON.parse(bad.body).error.code).toBe("notFound");
    expect((await http(studio.port, "POST", "/api/tools/call", { body: "{nope" })).status).toBe(400);
  });

  it("streams external changes on /api/events, not the API's own writes", async () => {
    const done = sse(studio.port, "/api/events", (t) => t.includes("external.txt"));
    await new Promise((r) => setTimeout(r, 200));
    await call(studio.port, "layer_update", { id: "bg", set: { opacity: 0.5 } });
    await new Promise((r) => setTimeout(r, 400));
    writeFileSync(join(project, "external.txt"), "x");
    const text = await done;
    expect(text).toContain("event: change");
    expect(text).toContain("external.txt");
    expect(text).not.toContain("photo.json");
  });
});

describe("studio API — template previews", () => {
  it("serves templates/<id>/preview.jpg (404 when missing)", async () => {
    const prev = process.env.AGENTPHOTO_TEMPLATES;
    const tpl = tempDir("agentphoto-templates-");
    mkdirSync(join(tpl, "promo-folder"), { recursive: true });
    writeFileSync(join(tpl, "promo-folder", "template.json"), JSON.stringify({ id: "promo", title: "Promo", description: "x", category: "ad", tags: [], width: 1080, height: 1080 }));
    writeFileSync(join(tpl, "promo-folder", "preview.jpg"), Buffer.from([0xff, 0xd8, 0xff]));
    mkdirSync(join(tpl, "plain"), { recursive: true });
    writeFileSync(join(tpl, "plain", "template.json"), JSON.stringify({ id: "plain", title: "Plain", description: "x", category: "ad", tags: [] }));
    process.env.AGENTPHOTO_TEMPLATES = tpl;
    try {
      const ok = await http(studio.port, "GET", "/api/templates/promo/preview.jpg");
      expect([ok.status, ok.type]).toEqual([200, "image/jpeg"]);
      expect((await http(studio.port, "GET", "/api/templates/plain/preview.jpg")).status).toBe(404);
      expect((await http(studio.port, "GET", "/api/templates/nope/preview.jpg")).status).toBe(404);
    } finally {
      if (prev === undefined) delete process.env.AGENTPHOTO_TEMPLATES;
      else process.env.AGENTPHOTO_TEMPLATES = prev;
    }
  });
});
