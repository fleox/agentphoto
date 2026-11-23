// Translated labels for catalog entries (filters, looks, effects, params,
// sizes…): the catalog is English; the UI looks names up in the bundles
// (en / fr) and falls back to the catalog title / a prettified id.

import { BLEND_MODES } from "../../core/types";
import { effectDef, filterDef, LOOKS, sizePreset } from "../../core/catalog";
import { tryTranslate } from "../i18n";

export function pretty(id: string): string {
  const s = id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// "golden-hour" → "goldenHour" (bundle keys).
export const camel = (id: string) => id.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

export const paramLabel = (name: string, _scope?: string): string => tryTranslate(`params.${name}`) ?? pretty(name);
export const blendTitle = (id: string): string => tryTranslate(`blend.${camel(id)}`) ?? pretty(id);
export const optionLabel = (_param: string, value: string): string => ((BLEND_MODES as readonly string[]).includes(value) ? blendTitle(value) : (tryTranslate(`options.${camel(value)}`) ?? pretty(value)));
export const filterTitle = (id: string): string => tryTranslate(`filterNames.${id}`) ?? filterDef(id)?.title ?? pretty(id);
export const filterGroupTitle = (id: string): string => tryTranslate(`filterGroups.${id}`) ?? pretty(id);
export const effectTitle = (id: string): string => tryTranslate(`effectNames.${id}`) ?? effectDef(id)?.title ?? pretty(id);
export const sizeTitle = (id: string): string => tryTranslate(`sizeNames.${camel(id)}`) ?? sizePreset(id)?.title ?? pretty(id);
export const lookTitle = (id: string): string => tryTranslate(`lookNames.${camel(id)}`) ?? LOOKS.find((l) => l.id === id)?.title ?? pretty(id);
