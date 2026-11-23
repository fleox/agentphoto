// Helpers shared by the tool files: input readers, compact results.

import type { Issue } from "../core/types";
import { OpsError } from "../ops/context";
import type { DocPlan } from "../ops/doc";
import type { JsonSchema } from "./types";

export function str(input: Record<string, unknown>, key: string, required = true): string {
  const v = input[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (required) throw new OpsError("invalid", `Missing "${key}" (string).`);
  return "";
}

export function optStr(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function bool(input: Record<string, unknown>, key: string, fallback = false): boolean {
  const v = input[key];
  return typeof v === "boolean" ? v : fallback;
}

export function num(input: Record<string, unknown>, key: string): number | undefined {
  const v = input[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

// Errors and warnings first, infos only when there is room; capped.
export function compactIssues(issues: Issue[], max = 40): { issues: Issue[]; omitted?: number } {
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  const shown = sorted.slice(0, max);
  return sorted.length > max ? { issues: shown, omitted: sorted.length - max } : { issues: shown };
}

export function issueCounts(issues: Issue[]): { errors: number; warnings: number; infos: number } {
  const c = { errors: 0, warnings: 0, infos: 0 };
  for (const i of issues) c[i.severity === "error" ? "errors" : i.severity === "warning" ? "warnings" : "infos"]++;
  return c;
}

export function mutationResult(r: { plan: DocPlan; issues: Issue[]; applied: boolean }, dryRun: boolean): Record<string, unknown> {
  const counts = issueCounts(r.issues);
  const status = counts.errors ? "refused" : r.plan.empty ? "unchanged" : dryRun ? "dry-run" : "applied";
  return {
    status,
    applied: r.applied,
    plan: r.plan.empty ? { summary: r.plan.summary } : r.plan,
    counts,
    ...compactIssues(r.issues.filter((i) => counts.errors === 0 || i.severity !== "info")),
    hint:
      status === "refused"
        ? "Nothing was written: fix the errors (each issue has a hint) and call again."
        : status === "applied"
          ? "Saved. Call render_preview and look at the image to verify the result."
          : status === "dry-run"
            ? "Dry run: call again without dryRun to write."
            : "The document already matches: nothing to do.",
  };
}

// Light input validation against the tool's JSON schema (required + top-level types).
export function checkInput(schema: JsonSchema, input: unknown, tool: string): Record<string, unknown> {
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) throw new OpsError("invalid", `${tool}: input must be a JSON object.`);
  const obj = input as Record<string, unknown>;
  for (const k of schema.required ?? []) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === "") throw new OpsError("invalid", `${tool}: missing required input "${k}".`, schema.properties?.[k]?.description);
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = schema.properties?.[k];
    if (!p || v === undefined || v === null || !p.type) continue;
    const types = Array.isArray(p.type) ? p.type : [p.type];
    const actual = Array.isArray(v) ? "array" : typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v;
    const ok = types.some((t) => t === actual || (t === "number" && actual === "integer"));
    if (!ok) throw new OpsError("invalid", `${tool}: "${k}" must be ${types.join(" or ")}, got ${actual}.`, p.description);
    if (p.enum && !p.enum.includes(v)) throw new OpsError("invalid", `${tool}: "${k}" must be one of ${p.enum.map((x) => JSON.stringify(x)).join(", ")}.`);
  }
  return obj;
}
