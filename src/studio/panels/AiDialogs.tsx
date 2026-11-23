// Local AI: the one-time download notice (model, size, licence, where it
// comes from) and the progress overlay while a tool runs.

import { Download, Loader2, ShieldCheck } from "lucide-react";
import { modelDef } from "../../core/catalog";
import { Dialog } from "../components/ui/Dialog";
import { Button } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { useEditor, useUi } from "../state/context";

const KEY = "agentphoto.studio.modelConsent.";

export function hasConsent(model: string): boolean {
  try {
    return localStorage.getItem(KEY + model) === "1";
  } catch {
    return false;
  }
}

function remember(model: string): void {
  try {
    localStorage.setItem(KEY + model, "1");
  } catch {
    /* ignore */
  }
}

export function AiConsentDialog() {
  const { t } = useI18n();
  const { backend } = useEditor();
  const req = useUi((s) => s.consent);
  if (!req) return null;
  const m = modelDef(req.model);
  return (
    <Dialog
      title={t("ai.consentTitle")}
      width={460}
      onClose={() => req.resolve(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => req.resolve(false)}>
            {t("ui.cancel")}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              remember(req.model);
              req.resolve(true);
            }}
          >
            <Download size={13} /> {t("ai.consentAccept", { size: m?.sizeMb ?? "?" })}
          </Button>
        </>
      }
    >
      <div className="space-y-3 p-4 text-sm">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-ink-2/50 p-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-agent/15 text-agent">
            <Download size={16} />
          </div>
          <div className="min-w-0">
            <div className="font-medium">
              {m?.id} <span className="text-fg-faint">· {m?.sizeMb} MB</span>
            </div>
            <div className="text-xs text-fg-muted">{m?.description}</div>
            <div className="mt-1 text-2xs text-fg-faint">
              {t("ai.license")}: {m?.license} · {m?.repo}
            </div>
          </div>
        </div>
        <p className="text-fg-muted">{backend.modelSource === "hub" ? t("ai.consentHub") : t("ai.consentCli")}</p>
        <p className="flex items-start gap-2 text-xs text-fg-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-agent" /> {t("ai.privacy")}
        </p>
      </div>
    </Dialog>
  );
}

export function BusyOverlay() {
  const busy = useUi((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center">
      <div className="toast-in pointer-events-auto flex min-w-[260px] items-center gap-2.5 rounded-lg border border-agent/30 bg-ink-1/95 px-3 py-2 shadow-xl shadow-black/40 backdrop-blur">
        <Loader2 size={14} className="animate-spin text-agent" />
        <div className="min-w-0 flex-1">
          <div className="text-sm">{busy.label}</div>
          {busy.progress !== undefined && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-3">
              <div className="h-full rounded-full bg-agent transition-[width]" style={{ width: `${Math.round(busy.progress * 100)}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
