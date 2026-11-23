// Tool options bar (under the top bar): the active tool's settings / actions.

import { useI18n } from "../i18n";
import { useUi } from "../state/context";
import { toolById } from "../tools/registry";

export function OptionsBar() {
  const { t } = useI18n();
  const tool = toolById(useUi((s) => s.tool));
  const Options = tool.Options;
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-ink-1/80 px-3">
      <div className="flex min-w-[118px] shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium text-fg">
        <tool.icon size={13} className="text-fg-muted" />
        {t(tool.label)}
      </div>
      <div className="h-4 w-px bg-line" />
      <div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap [&_span]:whitespace-nowrap">{Options ? <Options /> : <span className="text-xs text-fg-faint">{t(`tools.hints.${tool.id}`)}</span>}</div>
    </div>
  );
}
