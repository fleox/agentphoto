// Layer effects of the selected layer: drop shadow, outer glow, inner shadow,
// stroke, colour overlay — toggles + params generated from the catalog.

import clsx from "clsx";
import { Sparkle } from "lucide-react";
import { EFFECTS, type EffectDef } from "../../core/catalog";
import type { LayerEffects } from "../../core/types";
import { Empty, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { effectTitle } from "../lib/labels";
import { useEditor, useSelectedLayer } from "../state/context";
import { ParamField } from "./ParamField";

// The effect object with the catalog defaults (a fresh toggle-on).
export function defaultEffect(def: EffectDef): Record<string, unknown> {
  return Object.fromEntries(def.params.filter((p) => p.default !== undefined).map((p) => [p.name, p.default]));
}

export function EffectsPanel() {
  const { t } = useI18n();
  const api = useEditor();
  const layer = useSelectedLayer();
  if (!layer || layer.type === "adjustment")
    return (
      <Empty icon={<Sparkle size={22} />} title={t("effects.noLayer")}>
        {t("effects.noLayerHint")}
      </Empty>
    );
  const effects = (layer.effects ?? {}) as LayerEffects;
  const set = (id: EffectDef["id"], value: Record<string, unknown> | null, final = true) => api.edit([{ op: "updateLayer", id: layer.id, set: { effects: { [id]: value } } }], final ? {} : { coalesce: `fx:${layer.id}:${id}:${value ? Object.keys(value).join(",") : ""}` });
  return (
    <div className="pb-4">
      <div className="border-b border-line px-3 py-2">
        <div className="text-sm font-semibold">{t("effects.title")}</div>
        <div className="text-2xs text-fg-faint">{t("effects.hint")}</div>
      </div>
      <div className="space-y-1.5 p-2">
        {EFFECTS.map((def) => {
          const cur = effects[def.id] as Record<string, unknown> | null | undefined;
          const on = !!cur;
          return (
            <div key={def.id} className={clsx("overflow-hidden rounded-lg border bg-ink-2/40", on ? "border-line" : "border-line/60")}>
              <div className="flex h-8 items-center gap-2 px-2.5">
                <Toggle checked={on} onChange={(v) => set(def.id, v ? defaultEffect(def) : null)} ariaLabel={effectTitle(def.id)} />
                <span className={clsx("flex-1 text-sm font-medium", !on && "text-fg-muted")} title={def.description}>
                  {effectTitle(def.id)}
                </span>
              </div>
              {on && (
                <div className="border-t border-line/70 py-1">
                  {def.params.map((p) => (
                    <ParamField key={p.name} def={p} scope={def.id} value={cur![p.name]} onChange={(v, final) => set(def.id, { [p.name]: v === undefined ? null : v }, final)} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
