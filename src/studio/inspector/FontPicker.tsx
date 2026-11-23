// Font picker: the bundled catalog fonts, each previewed in its own face
// (loaded from the library through the engine's loader).

import clsx from "clsx";
import { useEffect, useState } from "react";
import { FONTS, fontDef } from "../../core/catalog";
import { PickerButton, Popover } from "../components/ui/Popover";
import { useI18n, type MessageKey } from "../i18n";
import { useEditor } from "../state/context";

function useFontsLoaded(): boolean {
  const { engine } = useEditor();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.all(FONTS.map((f) => engine.loader.font?.(f.id, f.weights.includes(700) ? 700 : f.weights[0], false).catch(() => null))).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [engine]);
  return ready;
}

export function FontPicker({ value, onChange }: { value: string; onChange(id: string): void }) {
  const { t } = useI18n();
  const ready = useFontsLoaded();
  const cur = fontDef(value);
  const styles = [...new Set(FONTS.map((f) => f.style))];
  return (
    <Popover
      width={260}
      align="start"
      anchorClass="flex min-w-0 flex-1"
      trigger={(open, isOpen) => (
        <PickerButton onClick={open} open={isOpen} ariaLabel={t("props.font")}>
          <span className="truncate" style={{ fontFamily: cur && ready ? `"${cur.family}"` : undefined }}>
            {cur?.family ?? value}
          </span>
        </PickerButton>
      )}
    >
      {(close) => (
        <div className="py-1">
          {styles.map((s) => (
            <div key={s}>
              <div className="px-3 pb-0.5 pt-2 text-2xs font-semibold uppercase tracking-wide text-fg-faint">{t(`fontStyles.${s}` as MessageKey)}</div>
              {FONTS.filter((f) => f.style === s).map((f) => (
                <button key={f.id} type="button" onClick={() => (onChange(f.id), close())} className={clsx("flex w-full items-baseline justify-between gap-2 px-3 py-1 text-left hover:bg-ink-3", f.id === value && "bg-accent/10")} title={f.description}>
                  <span className="truncate text-[15px] leading-6" style={{ fontFamily: ready ? `"${f.family}"` : undefined, fontWeight: f.weights.includes(700) ? 700 : f.weights[0] }}>
                    {f.family}
                  </span>
                  <span className="shrink-0 text-2xs text-fg-faint">{f.weights.length}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}
