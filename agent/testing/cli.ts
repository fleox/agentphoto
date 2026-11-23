import { main } from "../cli";
import type { Io } from "../output";

// Runs the CLI in-process with --json (the contract agents parse).

export interface CliRun {
  code: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: { ok: boolean; data?: any; error?: { code: string; message: string; hint?: string; details?: any } };
  stdout: string[];
  stderr: string[];
}

export async function cli(args: string[]): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: Io = { json: true, out: (t) => void stdout.push(t), err: (t) => void stderr.push(t) };
  const code = await main([...args, "--json"], io);
  return { code, body: JSON.parse(stdout.at(-1) ?? "{}"), stdout, stderr };
}

// `cli` that throws with the CLI error when a step that should succeed doesn't.
export async function ok(args: string[]) {
  const r = await cli(args);
  if (r.code !== 0 || !r.body.ok) throw new Error(`agentphoto ${args.join(" ")} → ${r.code}: ${JSON.stringify(r.body.error ?? r.body.data)}`);
  return r.body.data;
}
