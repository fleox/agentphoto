import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Temp folders created by a test file are removed once the file's tests are
// done (vitest runs each test file in its own module graph, so the list and
// the hook are per file). Set AGENTPHOTO_E2E_KEEP=1 to keep them for debugging.
const dirs: string[] = [];

afterAll(() => {
  if (process.env.AGENTPHOTO_E2E_KEEP) return;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A fresh folder under the OS temp dir, deleted after this test file. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
