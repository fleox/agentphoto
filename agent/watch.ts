import { statSync, watch, type FSWatcher } from "node:fs";
import { relative, sep } from "node:path";

// Watches a project folder (fs.watch recursive) and reports changed
// project-relative paths, debounced. renders/, dist/, .git and
// node_modules are ignored. Paths the caller just wrote itself can be
// muted (`ignoreWritten`, called AFTER the write) so API writes don't echo
// back as external changes: the event is dropped only while the file still
// has the size + mtime recorded then (a later external edit still reports).

export interface ProjectWatcher {
  close(): void;
  ignoreWritten(paths: string[]): void;
}

const IGNORED = /^(renders|dist|node_modules|\.git)(\/|$)|(^|\/)\.DS_Store$|~$|\.swp$/;

export function watchProject(root: string, onChange: (paths: string[]) => void, debounceMs = 120): ProjectWatcher {
  const pending = new Set<string>();
  const muted = new Map<string, string>();
  let timer: NodeJS.Timeout | null = null;
  let watcher: FSWatcher | null = null;
  const flush = () => {
    timer = null;
    const paths = [...pending].filter((p) => !isDir(`${root}/${p}`) && !(muted.has(p) && muted.get(p) === stamp(`${root}/${p}`)));
    pending.clear();
    if (paths.length) onChange(paths.sort());
  };
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = (typeof filename === "string" ? filename : String(filename)).split(sep).join("/");
      if (IGNORED.test(rel) || rel.startsWith("..") || relative(root, `${root}/${rel}`).startsWith("..")) return;
      pending.add(rel);
      if (!timer) timer = setTimeout(flush, debounceMs);
    });
    watcher.on("error", () => undefined);
  } catch {
    watcher = null;
  }
  return {
    close() {
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
    ignoreWritten(paths: string[]) {
      for (const p of paths) muted.set(p, stamp(`${root}/${p}`));
    },
  };
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function stamp(path: string): string {
  try {
    const s = statSync(path);
    return `${s.size}:${s.mtimeMs}`;
  } catch {
    return "missing";
  }
}
