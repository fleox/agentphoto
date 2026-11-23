import { describe, expect, it } from "vitest";
import { OpsError } from "../src/ops/context";
import { cliHint, printError, withCliHints } from "./output";

describe("CLI hints name commands, not AI tools", () => {
  it("translates tool names", () => {
    expect(cliHint("Use doc_summary to see the structure.")).toBe("Use `agentphoto doc summary` to see the structure.");
    expect(cliHint("layer_list lists the layer ids.")).toBe("`agentphoto layer list` lists the layer ids.");
    expect(cliHint("Call render_preview { zoom } on an edge.")).toBe("Call `agentphoto render` { zoom } on an edge.");
    expect(cliHint("refine with mask_generate (points)")).toBe("refine with `agentphoto mask generate` (points)");
  });
  it("keeps the CLI part of mixed hints", () => {
    expect(cliHint("List templates with templates_list / `agentphoto templates list`.")).toBe("List templates with `agentphoto templates list`.");
  });
  it("leaves other text alone", () => {
    expect(cliHint("Run check before export.")).toBe("Run check before export.");
  });
  it("rewrites nested result hints and ops errors", () => {
    expect(withCliHints({ issues: [{ code: "x", hint: "see doc_summary", message: "doc_summary stays" }] })).toEqual({ issues: [{ code: "x", hint: "see `agentphoto doc summary`", message: "doc_summary stays" }] });
    let out = "";
    const code = printError({ json: true, out: (t) => void (out += t), err: () => undefined }, new OpsError("notFound", "nope", "Use layer_list."));
    expect(code).toBe(1);
    expect(JSON.parse(out).error).toEqual({ code: "notFound", message: "nope", hint: "Use `agentphoto layer list`." });
    out = "";
    expect(printError({ json: true, out: (t) => void (out += t), err: () => undefined }, new OpsError("invalid", "bad"))).toBe(2);
    expect(JSON.parse(out).error.hint).toBeTruthy();
  });
});
