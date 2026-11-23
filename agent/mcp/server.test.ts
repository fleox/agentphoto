import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createMcpServer, isRefusal, serveStdio, STRUCTURED_MAX_CHARS, type JsonRpcResponse, type McpTool } from "./server";

// MCP over an in-process stdio pair: handshake, tools/list (annotations,
// read-only mode), tools/call (structured result + text + image blocks,
// tool errors as isError results), resources.

const TOOLS: McpTool[] = [
  { name: "doc_summary", description: "Outline.", inputSchema: { type: "object", properties: {} }, mutating: false },
  { name: "doc_patch", description: "Patch.", inputSchema: { type: "object", properties: { ops: { type: "array" } } }, mutating: true },
  { name: "layer_remove", description: "Remove.", inputSchema: { type: "object", properties: { id: { type: "string" } } }, mutating: true },
  { name: "render_preview", description: "Render.", inputSchema: { type: "object", properties: {} }, mutating: false },
];

function setup(readOnly = false) {
  const calls: string[] = [];
  const server = createMcpServer({
    readOnly,
    tools: TOOLS,
    serverName: "agentphoto",
    version: "0.1.0",
    instructions: "Test.",
    async call(name, input) {
      calls.push(name);
      if (name === "layer_remove") {
        const err = new Error(`No layer "${String(input.id)}".`) as Error & { code: string; hint: string };
        err.name = "OpsError";
        err.code = "notFound";
        err.hint = "List ids with layer_list.";
        throw err;
      }
      if (name === "doc_patch") return { status: "refused", applied: false, counts: { errors: 1, warnings: 0, infos: 0 }, issues: [{ severity: "error", code: "x", path: "layers#a", message: "Bad" }] };
      if (name === "render_preview") return { frames: [{ t: 0, path: "/tmp/x.png" }], sheet: "/tmp/sheet.png" };
      if (name === "doc_summary" && input.big) return { blob: "x".repeat(20_000) };
      return { layers: 1, input };
    },
    images: async (name) => (name === "render_preview" ? [{ data: "/9j/4AAQ", mimeType: "image/jpeg" }] : []),
    resources: [{ uri: "photo://doc", name: "doc", title: "Document", description: "The document.", mimeType: "application/json", read: async () => ({ version: 1 }) }],
  });
  const input = new PassThrough();
  const lines: string[] = [];
  const done = serveStdio(server, input, (l) => void lines.push(l));
  let nextId = 1;
  const request = async (method: string, params?: unknown): Promise<JsonRpcResponse> => {
    const id = nextId++;
    input.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }) + "\n");
    for (let i = 0; i < 200; i++) {
      const hit = lines.map((l) => JSON.parse(l) as JsonRpcResponse).find((r) => !Array.isArray(r) && r.id === id);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`no answer to ${method}`);
  };
  return { server, request, input, lines, calls, close: () => (input.end(), done) };
}

describe("MCP server", () => {
  it("negotiates the protocol, lists and calls tools", async () => {
    const t = setup();
    const init = await t.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "agentphoto" }, capabilities: { tools: {}, resources: {} } });
    t.input.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    expect(((await t.request("initialize", { protocolVersion: "2024-11-05" })).result as { protocolVersion: string }).protocolVersion).toBe("2024-11-05");
    expect(((await t.request("initialize", { protocolVersion: "1999-01-01" })).result as { protocolVersion: string }).protocolVersion).toBe("2025-06-18");
    expect(t.server.initialized).toBe(true);
    expect((await t.request("ping")).result).toEqual({});

    const list = (await t.request("tools/list")).result as { tools: { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[] };
    expect(list.tools.map((x) => x.name)).toEqual(TOOLS.map((x) => x.name));
    expect(list.tools.find((x) => x.name === "doc_summary")!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(list.tools.find((x) => x.name === "layer_remove")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(list.tools.find((x) => x.name === "doc_patch")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });

    const call = (await t.request("tools/call", { name: "doc_summary", arguments: { a: 1 } })).result as { content: { type: string; text: string }[]; structuredContent: unknown; isError: boolean };
    expect(call.isError).toBe(false);
    expect(call.structuredContent).toEqual({ layers: 1, input: { a: 1 } });
    expect(JSON.parse(call.content[0].text)).toEqual({ layers: 1, input: { a: 1 } });

    const render = (await t.request("tools/call", { name: "render_preview", arguments: {} })).result as { content: { type: string; data?: string; mimeType?: string }[] };
    expect(render.content.map((c) => c.type)).toEqual(["text", "image"]);
    expect(render.content[1]).toMatchObject({ mimeType: "image/jpeg", data: "/9j/4AAQ" });

    const failed = (await t.request("tools/call", { name: "layer_remove", arguments: { id: "nope" } })).result as { isError: boolean; structuredContent: { error: { code: string; hint: string } } };
    expect(failed.isError).toBe(true);
    expect(failed.structuredContent.error).toMatchObject({ code: "notFound", hint: expect.stringContaining("layer_list") });

    // A refusal (nothing written, validation errors) is an error result carrying the issues.
    const refused = (await t.request("tools/call", { name: "doc_patch", arguments: {} })).result as { isError: boolean; structuredContent: { status: string } };
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.status).toBe("refused");
    expect(isRefusal({ status: "applied", applied: true })).toBe(false);
    expect(isRefusal({ ok: false, counts: { errors: 2 } })).toBe(false); // doc_validate / check report, not a refusal

    expect((await t.request("tools/call", { name: "nope" })).error).toMatchObject({ code: -32602 });
    expect((await t.request("frobnicate")).error).toMatchObject({ code: -32601 });

    const res = (await t.request("resources/list")).result as { resources: { uri: string }[] };
    expect(res.resources.map((r) => r.uri)).toEqual(["photo://doc"]);
    const read = (await t.request("resources/read", { uri: "photo://doc" })).result as { contents: { text: string }[] };
    expect(JSON.parse(read.contents[0].text)).toEqual({ version: 1 });
    expect((await t.request("resources/read", { uri: "photo://nope" })).error).toMatchObject({ code: -32002 });
    await t.close();
  });

  it("sends compact JSON text and structuredContent only for small results on 2025-06-18", async () => {
    const t = setup();
    await t.request("initialize", { protocolVersion: "2025-06-18" });
    const small = (await t.request("tools/call", { name: "doc_summary", arguments: { a: 1 } })).result as { content: { text: string }[]; structuredContent?: unknown };
    expect(small.content[0].text).toBe('{"layers":1,"input":{"a":1}}');
    expect(small.structuredContent).toBeDefined();
    const big = (await t.request("tools/call", { name: "doc_summary", arguments: { big: true } })).result as { content: { text: string }[]; structuredContent?: unknown };
    expect(big.content[0].text.length).toBeGreaterThan(STRUCTURED_MAX_CHARS);
    expect(big.structuredContent).toBeUndefined();
    // Older protocol versions have no structuredContent.
    await t.request("initialize", { protocolVersion: "2025-03-26" });
    const old = (await t.request("tools/call", { name: "doc_summary", arguments: { a: 1 } })).result as { structuredContent?: unknown };
    expect(old.structuredContent).toBeUndefined();
    await t.close();
  });

  it("read-only mode hides and refuses mutating tools", async () => {
    const t = setup(true);
    const list = (await t.request("tools/list")).result as { tools: { name: string }[] };
    expect(list.tools.map((x) => x.name)).toEqual(["doc_summary", "render_preview"]);
    expect((await t.request("tools/call", { name: "doc_patch", arguments: {} })).error).toMatchObject({ code: -32602, message: expect.stringContaining("read-only") });
    expect(t.calls).toEqual([]);
    expect(((await t.request("initialize", {})).result as { instructions: string }).instructions).toContain("READ-ONLY");
    await t.close();
  });

  it("answers parse errors, invalid requests and batches", async () => {
    const t = setup();
    t.input.write("{nope\n");
    t.input.write(JSON.stringify({ id: 9, method: "ping" }) + "\n");
    t.input.write(JSON.stringify([{ jsonrpc: "2.0", id: 10, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]) + "\n");
    await t.close();
    const msgs = t.lines.map((l) => JSON.parse(l));
    expect(msgs[0]).toMatchObject({ id: null, error: { code: -32700 } });
    expect(msgs[1]).toMatchObject({ id: 9, error: { code: -32600 } });
    expect(msgs[2]).toEqual([{ jsonrpc: "2.0", id: 10, result: {} }]);
  });
});

describe("MCP server over the real tool catalog", () => {
  it("lists every AI tool (pixel tools included) with AgentPhoto annotations", async () => {
    const { listTools } = await import("../aiHost");
    const { mcpOptions } = await import("../commands/tools");
    const { NodeFs } = await import("../nodeFs");
    const { AI_TOOLS } = await import("../../src/ai/tools");
    const tools = await listTools();
    expect(tools.map((t) => t.name)).toEqual(AI_TOOLS.map((t) => t.name));
    const server = createMcpServer(mcpOptions(new NodeFs("/tmp/none"), false, tools));
    const list = (await server.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }))!.result as { tools: { name: string; annotations: { destructiveHint: boolean; openWorldHint: boolean; readOnlyHint: boolean } }[] };
    const ann = (n: string) => list.tools.find((t) => t.name === n)!.annotations;
    for (const n of ["doc_apply", "layer_remove", "assets_remove", "export"]) expect(ann(n).destructiveHint).toBe(true);
    for (const n of ["assets_add", "remove_background", "mask_generate"]) expect(ann(n).openWorldHint).toBe(true);
    expect(ann("render_preview")).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    const ro = createMcpServer(mcpOptions(new NodeFs("/tmp/none"), true, tools));
    expect(ro.toolNames()).toContain("render_preview");
    expect(ro.toolNames()).not.toContain("doc_patch");
    const init = (await server.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} }))!.result as { instructions: string };
    expect(init.instructions).toMatch(/render_preview/);
    expect(init.instructions).toMatch(/image_analyze/);
  });
});
