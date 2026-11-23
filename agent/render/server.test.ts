import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveUnder, startLocalServer, type LocalServer } from "./server";
import { tempDir } from "../testing/tmp";

// Raw HTTP (fetch would normalise "..").
function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

let server: LocalServer;
let root = "";

beforeAll(async () => {
  root = tempDir("agentphoto-srv-");
  mkdirSync(join(root, "project", "assets"), { recursive: true });
  writeFileSync(join(root, "project", "photo.json"), '{"ok":1}');
  writeFileSync(join(root, "secret.txt"), "secret");
  symlinkSync(join(root, "secret.txt"), join(root, "project", "assets", "link.txt"));
  server = await startLocalServer({ mounts: { "/project/": join(root, "project") }, routes: [(_q, res, url) => (url.pathname === "/hello" ? (res.end("hi"), true) : false)] });
});
afterAll(() => server.close());

describe("local server", () => {
  it("binds 127.0.0.1 and serves mounts + routes", async () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(await get(server.port, "/project/photo.json")).toEqual({ status: 200, body: '{"ok":1}' });
    expect((await get(server.port, "/hello")).body).toBe("hi");
    expect((await get(server.port, "/nope")).status).toBe(404);
  });

  it("never serves files outside a mount", async () => {
    for (const p of ["/project/../secret.txt", "/project/%2e%2e/secret.txt", "/project/%2e%2e%2fsecret.txt", "/project/..%5csecret.txt", "/project/assets/link.txt", "/project/%00"]) {
      const r = await get(server.port, p);
      expect({ p, status: r.status }).toEqual({ p, status: 404 });
      expect(r.body).not.toContain("secret");
    }
    expect(resolveUnder("/a/b", "../c")).toBeNull();
    expect(resolveUnder("/a/b", "c/d.png")).toBe("/a/b/c/d.png");
  });
});
