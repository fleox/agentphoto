import type { ToolCtx } from "../tools/types";

// The viewport's tool context (set while the viewport is mounted): keyboard
// shortcuts hand keys to the active tool through it.
export const toolCtx: { current: ToolCtx | null } = { current: null };
