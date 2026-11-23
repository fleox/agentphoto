// A control generated from a catalog ParamDef (filters, layer effects):
// number → slider + field, int, color → picker, enum → select, boolean →
// switch, curve → curve editor, stops → gradient stops, rgb → 3 sliders.

import { useState } from "react";
import type { ParamDef } from "../../core/catalog";
import type { ColorStop } from "../../core/types";
import { ColorField } from "../components/ui/ColorPicker";
import { CurveEditor, type CurvePoints } from "../components/ui/CurveEditor";
import { SliderField } from "../components/ui/NumberField";
import { StopsEditor } from "../components/ui/PaintEditor";
import { Row, Select, Toggle } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { optionLabel, paramLabel } from "../lib/labels";
import { stopsOf } from "../lib/paint";

export function ParamField({ def, value, onChange, scope }: { def: ParamDef; value: unknown; onChange(v: unknown, final: boolean): void; scope?: string }) {
  const label = paramLabel(def.name, scope);
  const cur = value === undefined ? def.default : value;
  const overridden = value !== undefined && JSON.stringify(value) !== JSON.stringify(def.default);
  const reset = () => onChange(undefined, true);
  switch (def.type) {
    case "number":
    case "int":
      return (
        <Row label={label} hint={def.description} overridden={overridden} onReset={reset}>
          <SliderField value={typeof cur === "number" ? cur : 0} min={def.min ?? 0} max={def.max ?? 100} step={def.step} integer={def.type === "int"} onChange={(v, final) => onChange(v, final)} ariaLabel={label} />
        </Row>
      );
    case "boolean":
      return (
        <Row label={label} hint={def.description} overridden={overridden} onReset={reset}>
          <Toggle checked={!!cur} onChange={(v) => onChange(v, true)} ariaLabel={label} />
        </Row>
      );
    case "color":
      return (
        <Row label={label} hint={def.description} overridden={overridden} onReset={reset}>
          <ColorField value={typeof cur === "string" ? cur : "#000000"} onChange={onChange} />
        </Row>
      );
    case "enum":
      return (
        <Row label={label} hint={def.description} overridden={overridden} onReset={reset}>
          <Select value={String(cur ?? "")} options={(def.options ?? []).map((o) => ({ value: o, label: optionLabel(def.name, o) }))} onChange={(v) => onChange(v, true)} ariaLabel={label} />
        </Row>
      );
    case "rgb": {
      const v = Array.isArray(cur) && cur.length === 3 ? (cur as number[]) : [0, 0, 0];
      const colors = ["#f2766d", "#7bd88f", "#6fa8ff"];
      return (
        <div className="px-3 py-1">
          <div className="mb-0.5 flex items-center justify-between text-xs text-fg-muted" title={def.description}>
            {label}
            {overridden && (
              <button type="button" onClick={reset} className="text-2xs text-fg-faint hover:text-fg">
                ↺
              </button>
            )}
          </div>
          {v.map((n, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors[i] }} />
              <SliderField value={n} min={def.min ?? -100} max={def.max ?? 100} integer onChange={(x, final) => onChange(v.map((y, k) => (k === i ? x : y)), final)} ariaLabel={`${label} ${i + 1}`} />
            </div>
          ))}
        </div>
      );
    }
    case "stops": {
      const stops = stopsOf({ type: "linear", stops: Array.isArray(cur) ? (cur as (ColorStop | string)[]) : ["#000000", "#ffffff"] });
      return (
        <div className="px-3 py-1.5">
          <div className="mb-1 text-xs text-fg-muted" title={def.description}>
            {label}
          </div>
          <StopsEditor stops={stops} onChange={(s, final) => onChange(s, final)} />
        </div>
      );
    }
    case "curve":
      return null; // CurvesCard handles the four curves together.
    default:
      return null;
  }
}

export function CurvesField({ filter, onChange }: { filter: Record<string, unknown>; onChange(name: string, v: unknown, final: boolean): void }) {
  return <CurvesInner filter={filter} onChange={onChange} />;
}

const CHANNELS = [
  { id: "rgb", color: "rgb(var(--fg))" },
  { id: "red", color: "#f2766d" },
  { id: "green", color: "#7bd88f" },
  { id: "blue", color: "#6fa8ff" },
] as const;

function CurvesInner({ filter, onChange }: { filter: Record<string, unknown>; onChange(name: string, v: unknown, final: boolean): void }) {
  const { t } = useI18n();
  const [ch, setCh] = useState<(typeof CHANNELS)[number]["id"]>("rgb");
  const def = CHANNELS.find((c) => c.id === ch)!;
  const pts = (Array.isArray(filter[ch]) ? filter[ch] : [[0, 0], [255, 255]]) as CurvePoints;
  return (
    <div className="space-y-1.5 px-3 py-1.5">
      <div className="flex gap-0.5">
        {CHANNELS.map((c) => (
          <button key={c.id} type="button" onClick={() => setCh(c.id)} className={`flex h-6 flex-1 items-center justify-center gap-1 rounded text-xs ${ch === c.id ? "bg-ink-3 text-fg" : "text-fg-muted hover:text-fg"}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
            {t(`curve.${c.id}`)}
          </button>
        ))}
      </div>
      <CurveEditor points={pts} color={def.color} onChange={(p, final) => onChange(ch, p, final)} />
      <div className="flex justify-between text-2xs text-fg-faint">
        <span>{t("curve.hint")}</span>
        {Array.isArray(filter[ch]) && (
          <button type="button" onClick={() => onChange(ch, undefined, true)} className="hover:text-fg">
            {t("curve.reset")}
          </button>
        )}
      </div>
    </div>
  );
}
