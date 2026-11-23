import { describe, expect, it } from "vitest";
import { runLoop, type LoopEvent } from "./loop";

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("assistant loop", () => {
  it("runs tools, sends results back (with the render image) and stops at end_turn", async () => {
    const bodies: Record<string, unknown>[] = [];
    const headers: Record<string, string>[] = [];
    const responses = [
      { content: [{ type: "text", text: "Rendering." }, { type: "tool_use", id: "t1", name: "render_preview", input: {} }, { type: "tool_use", id: "t2", name: "doc_patch", input: { ops: [] } }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" },
    ];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      headers.push(init.headers as Record<string, string>);
      return reply(responses.shift());
    }) as unknown as typeof fetch;
    const events: LoopEvent[] = [];
    const r = await runLoop({
      apiKey: "k",
      model: "claude-sonnet-5-5",
      system: "s",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "render_preview", description: "", inputSchema: { type: "object" }, mutating: false }],
      callTool: async (name) => {
        if (name === "doc_patch") throw Object.assign(new Error("Bad op"), { hint: "fix it" });
        return { preview: "renders/preview-1.png", images: ["renders/preview-1-before.png", "renders/preview-1.png"] };
      },
      readImage: async () => "AAAA",
      onEvent: (e) => events.push(e),
      fetchImpl,
    });
    expect(r.status).toBe("done");
    expect(headers[0]["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(bodies[0]).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default", tools: [{ name: "render_preview", input_schema: { type: "object" } }] });
    const results = (bodies[1].messages as { role: string; content: { type: string; content: { type: string }[]; is_error?: boolean }[] }[]).at(-1)!;
    expect(results.role).toBe("user");
    expect(results.content).toHaveLength(2);
    expect(results.content[0].content.map((c) => c.type)).toEqual(["text", "image", "image"]);
    expect(results.content[1].is_error).toBe(true);
    expect(events.map((e) => e.type)).toEqual(["text", "tool_start", "tool_end", "tool_start", "tool_end", "text"]);
  });

  it("retries without fallbacks when the API rejects the beta, and reports API errors", async () => {
    let n = 0;
    const fetchImpl = (async (_u: string, init: RequestInit) => {
      n++;
      const body = JSON.parse(String(init.body));
      if (body.fallbacks) return reply({ error: { message: "Unknown beta / fallbacks" } }, 400);
      return reply({ error: { message: "invalid x-api-key" } }, 401);
    }) as unknown as typeof fetch;
    const r = await runLoop({ apiKey: "k", model: "claude-opus-5-5", system: "", messages: [{ role: "user", content: "x" }], tools: [], callTool: async () => null, onEvent: () => undefined, fetchImpl });
    expect(n).toBe(2);
    expect(r).toMatchObject({ status: "error", error: "invalid x-api-key" });
  });
});
