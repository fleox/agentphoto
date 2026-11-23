// Boot: detect the CLI API (GET ./api/info) → RemoteBackend, else in-browser
// projects (LocalBackend). No project → start screen.

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LocalBackend } from "./backend/local";
import { detectApi, RemoteBackend } from "./backend/remote";
import type { Backend } from "./backend/types";
import { useI18n } from "./i18n";
import { urlParam } from "./lib/urlState";
import { Editor } from "./Editor";
import { StartScreen } from "./panels/StartScreen";

export function App() {
  const { t } = useI18n();
  const [backend, setBackend] = useState<Backend | null>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const info = await detectApi();
      let b: Backend;
      if (info) b = new RemoteBackend(info);
      else {
        const local = new LocalBackend();
        await local.init();
        const id = urlParam("project");
        if (id) await local.open(id).catch(() => undefined);
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
  if (!open) return <StartScreen backend={backend} onOpened={onOpened} />;
  return <Editor key={session} backend={backend} onClose={onClose} />;
}
