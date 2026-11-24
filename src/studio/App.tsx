// Boot: detect the CLI API (GET ./api/info) → RemoteBackend, else in-browser
// projects (LocalBackend). No project → start screen. In local mode,
// #import=<ref> opens a project bundle or an image from a link (importLink.ts).

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LocalBackend } from "./backend/local";
import { detectApi, RemoteBackend } from "./backend/remote";
import type { Backend } from "./backend/types";
import { useI18n, type MessageKey } from "./i18n";
import { bundleId, fetchImport, ImportError, loadConfig, parseBundle, resolveImport, sessionOf } from "./lib/importLink";
import { urlParam } from "./lib/urlState";
import { Editor } from "./Editor";
import { StartScreen } from "./panels/StartScreen";

// Imports the #import link into the browser's projects; the link is then
// replaced by ?project=<id>, so a reload does not import again.
async function importFromLink(local: LocalBackend, ref: string): Promise<void> {
  const config = await loadConfig();
  const url = resolveImport(ref, config, sessionOf(config, urlParam("session"), document.referrer), location.href);
  const got = await fetchImport(url, ref);
  if (got.kind === "image") await local.createProject({ title: got.name.replace(/\.[^.]+$/, ""), image: { name: got.name, bytes: got.bytes } });
  else {
    const bundle = parseBundle(new TextDecoder().decode(got.bytes));
    await local.importProject(await bundleId(bundle.title, got.bytes), bundle.title, bundle.files);
  }
  const id = local.location;
  history.replaceState(null, "", `${location.pathname}${id ? `?project=${encodeURIComponent(id)}` : ""}`);
}

export function App() {
  const { t } = useI18n();
  const [backend, setBackend] = useState<Backend | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [importError, setImportError] = useState<MessageKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await detectApi();
      let b: Backend;
      if (info) b = new RemoteBackend(info);
      else {
        const local = new LocalBackend();
        await local.init({ ortBase: (await loadConfig()).ortBase });
        const ref = urlParam("import");
        const id = urlParam("project");
        if (ref)
          await importFromLink(local, ref).catch((e: unknown) =>
            setImportError(e instanceof ImportError ? (`linkImport.${e.code}` as MessageKey) : "linkImport.fetch"),
          );
        else if (id) await local.open(id).catch(() => undefined);
        b = local;
      }
      if (cancelled) return;
      setBackend(b);
      setOpen(b.hasProject() && urlParam("start") !== "1");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onOpened = useCallback(() => {
    setSession((s) => s + 1);
    setOpen(true);
  }, []);
  const onClose = useCallback(() => setOpen(false), []);

  if (!backend)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-fg-muted">
        <Loader2 size={16} className="animate-spin" /> {t("app.loading")}
      </div>
    );
  if (!open)
    return (
      <>
        {importError && (
          <div role="alert" className="fixed left-1/2 top-3 z-50 max-w-lg -translate-x-1/2 rounded-lg border border-line bg-ink-1 px-4 py-2 text-sm text-fg shadow-lg">
            {t(importError)}
          </div>
        )}
        <StartScreen backend={backend} onOpened={onOpened} />
      </>
    );
  return <Editor key={session} backend={backend} onClose={onClose} />;
}
