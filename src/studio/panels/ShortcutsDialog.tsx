import { Dialog } from "../components/ui/Dialog";
import { Kbd } from "../components/ui/controls";
import { useI18n, type MessageKey } from "../i18n";
import { useEditor } from "../state/context";
import { TOOLS } from "../tools/registry";

const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const M = mac ? "⌘" : "Ctrl";

const GENERAL: [string[], MessageKey][] = [
  [[M, "Z"], "keys.undo"],
  [[M, "⇧", "Z"], "keys.redo"],
  [[M, "S"], "keys.save"],
  [[M, "D"], "keys.duplicate"],
  [[M, "G"], "keys.group"],
  [[M, "⇧", "G"], "keys.ungroup"],
  [[M, "A"], "keys.selectAll"],
  [["⌫"], "keys.delete"],
  [["←", "→", "↑", "↓"], "keys.nudge"],
  [["⇧", "↑"], "keys.nudge10"],
  [["Esc"], "keys.deselect"],
  [["Tab"], "keys.panels"],
  [[M, "V"], "keys.paste"],
  [["?"], "keys.help"],
];

const VIEW: [string[], MessageKey][] = [
  [[M, "0"], "keys.fit"],
  [[M, "1"], "keys.actual"],
  [[M, "+"], "keys.zoomIn"],
  [[M, "−"], "keys.zoomOut"],
  [[M, "wheel"], "keys.zoomWheel"],
  [["Space", "drag"], "keys.pan"],
  [["⇧", "drag"], "keys.keepRatio"],
  [[M, "drag"], "keys.noSnap"],
  [["Enter"], "keys.commitCrop"],
  [["⇧", "drag"], "keys.dragFast"],
  [["Alt", "drag"], "keys.dragFine"],
];

export function ShortcutsDialog() {
  const { t } = useI18n();
  const { ui } = useEditor();
  return (
    <Dialog title={t("keys.title")} width={760} onClose={() => ui.set({ dialog: null })}>
      <div className="grid gap-x-6 px-4 py-2 sm:grid-cols-3">
        <div>
          <div className="pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-faint">{t("keys.tools")}</div>
          <Rows rows={TOOLS.map((x) => [[x.shortcut], x.label] as [string[], MessageKey])} />
        </div>
        <div>
          <div className="pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-faint">{t("keys.general")}</div>
          <Rows rows={GENERAL} />
        </div>
        <div>
          <div className="pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-fg-faint">{t("keys.view")}</div>
          <Rows rows={VIEW} />
        </div>
      </div>
    </Dialog>
  );
}

function Rows({ rows }: { rows: [string[], MessageKey][] }) {
  const { t } = useI18n();
  return (
    <div className="divide-y divide-line">
      {rows.map(([keys, label], i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm">
          <span className="text-fg-muted">{t(label)}</span>
          <span className="flex shrink-0 gap-1">
            {keys.map((k) => (
              <Kbd key={k}>{k === "wheel" ? t("keys.wheelKey") : k === "drag" ? t("keys.dragKey") : k}</Kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}
