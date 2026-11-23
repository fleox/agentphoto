// Optional chat with Claude using the user's own Anthropic API key (kept in
// localStorage, sent only to api.anthropic.com). Same tool catalog as the
// CLI / MCP; mutating calls are applied directly and shown as cards with Undo.

import clsx from "clsx";
import { Bot, Check, CircleAlert, Eye, EyeOff, KeyRound, Loader2, Pencil, RotateCcw, Send, Settings2, Square, SquarePen, Wrench, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PhotoDoc } from "../../core/types";
import { findLayer } from "../../ops/tree";
import { Button, IconButton } from "../components/ui/controls";
import { useI18n } from "../i18n";
import { useEditor } from "../state/context";
import { DEFAULT_MODEL, MODELS, SYSTEM_PROMPT, runLoop, type Message } from "./loop";

const KEY_STORE = "agentphoto.studio.anthropicKey";
const MODEL_STORE = "agentphoto.studio.model";
const read = (k: string) => {
  try {
    return localStorage.getItem(k) ?? "";
  } catch {
    return "";
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

type Item =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; input: Record<string, unknown>; status: "running" | "done" | "error" | "undone"; mutating: boolean; summary?: string; error?: string; images?: string[]; before?: PhotoDoc }
  | { kind: "notice"; id: string; text: string; tone?: "error" };

interface Conversation {
  messages: Message[];
  items: Item[];
}
// Survives closing the panel (per project, this page session only).
const conversations = new Map<string, Conversation>();
let seq = 0;
const uid = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function summarize(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as { status?: string; plan?: { summary?: string }; counts?: { errors: number; warnings: number }; hint?: string };
  if (r.plan?.summary) return `${r.status ?? ""} · ${r.plan.summary}`;
  if (r.status) return r.status;
  return undefined;
}

function inputSummary(name: string, input: Record<string, unknown>): string {
  if (name === "doc_patch" && Array.isArray(input.ops)) return (input.ops as { op: string; path?: string; id?: string }[]).map((o) => `${o.op} ${o.path ?? o.id ?? ""}`.trim()).slice(0, 3).join(", ") + ((input.ops as unknown[]).length > 3 ? "…" : "");
  if (name === "catalog_get") return [input.section, input.id].filter(Boolean).join(" / ");
  if (name === "layer_update" || name === "layer_remove" || name === "remove_background" || name === "mask_generate" || name === "mask_set" || name === "filter_add") return [input.id, (input.filter as { type?: string })?.type, input.method].filter(Boolean).join(" · ");
  if (name === "layer_add") return String((input.layer as { id?: string })?.id ?? "");
  const s = JSON.stringify(input);
  return s === "{}" ? "" : s.slice(0, 80);
}

// Minimal inline formatting: **bold**, `code`, paragraphs and "- " lists.
function RichText({ text }: { text: string }) {
  const inline = (s: string, k: string) =>
    s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("`") && part.endsWith("`") ? (
        <code key={`${k}${i}`} className="rounded bg-ink-3 px-1 font-mono text-2xs">
          {part.slice(1, -1)}
        </code>
      ) : part.startsWith("**") && part.endsWith("**") ? (
        <strong key={`${k}${i}`}>{part.slice(2, -2)}</strong>
      ) : (
        part
      ),
    );
  return (
    <div className="space-y-1.5">
      {text.split(/\n{2,}/).map((para, i) =>
        /^\s*[-*] /.test(para) ? (
          <ul key={i} className="list-disc space-y-0.5 pl-4">
            {para.split("\n").map((l, j) => (
              <li key={j}>{inline(l.replace(/^\s*[-*] /, ""), `${i}-${j}-`)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {inline(para, `${i}-`)}
          </p>
        ),
      )}
    </div>
  );
}

export function AssistantPanel() {
  const { t } = useI18n();
  const { backend, store, tools, reloadDoc, ui } = useEditor();
  const convKey = backend.location ?? "default";
  const [conv, setConv] = useState<Conversation>(() => conversations.get(convKey) ?? { messages: [], items: [] });
  const [apiKey, setApiKey] = useState(() => read(KEY_STORE));
  const [model, setModel] = useState(() => read(MODEL_STORE) || DEFAULT_MODEL);
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const convRef = useRef(conv);
  convRef.current = conv;

  useEffect(() => {
    conversations.set(convKey, conv);
  }, [conv, convKey]);
  useEffect(() => {
    // Block body: scrollIntoView returns a Promise in recent Chrome (not a valid effect cleanup).
    void endRef.current?.scrollIntoView({ block: "end" });
  }, [conv.items.length]);
  useEffect(() => () => abort.current?.abort(), []);

  const update = (fn: (items: Item[]) => Item[]) => setConv((c) => ({ ...c, items: fn(c.items) }));
  const patchTool = (id: string, p: Partial<Extract<Item, { kind: "tool" }>>) => update((items) => items.map((it) => (it.kind === "tool" && it.id === id ? { ...it, ...p } : it)));

  const send = async () => {
    const text = draft.trim();
    if (!text || running || !apiKey) return;
    setDraft("");
    setRunning(true);
    const controller = new AbortController();
    abort.current = controller;
    const snap = store.getSnapshot();
    const sel = snap.selection;
    const selLayer = sel.length && snap.doc ? findLayer(snap.doc.layers, sel[sel.length - 1])?.layer : null;
    const context = `[Studio] Project: ${backend.projectTitle()}.${snap.doc ? ` Canvas ${snap.doc.canvas.width}×${snap.doc.canvas.height}.` : ""}${selLayer ? ` Selected layer: "${selLayer.id}" (${selLayer.type})${sel.length > 1 ? `, ${sel.length} layers selected: ${sel.join(", ")}` : ""}.` : " Nothing selected."}`;
    const messages: Message[] = [...convRef.current.messages, { role: "user", content: [{ type: "text", text: context }, { type: "text", text }] }];
    setConv((c) => ({ messages, items: [...c.items, { kind: "user", id: uid(), text }] }));
    await store.flush();
    const mutating = new Set(tools.filter((x) => x.mutating).map((x) => x.name));
    const befores = new Map<string, PhotoDoc>();
    let currentToolId = "";

    const r = await runLoop({
      apiKey,
      model,
      system: SYSTEM_PROMPT,
      messages,
      tools,
      signal: controller.signal,
      callTool: async (name, input) => {
        const id = currentToolId;
        if (mutating.has(name)) {
          await store.flush();
          const before = store.getSnapshot().doc;
          if (before) befores.set(id, before);
        }
        const result = await backend.call(name, input);
        if (mutating.has(name)) await reloadDoc({ toast: false }).catch(() => undefined);
        return result;
      },
      readImage: async (path) => toBase64(await backend.readFile(path)),
      onEvent: (ev) => {
        if (ev.type === "text") update((items) => [...items, { kind: "assistant", id: uid(), text: ev.text }]);
        else if (ev.type === "tool_start") {
          currentToolId = ev.id;
          update((items) => [...items, { kind: "tool", id: ev.id, name: ev.name, input: ev.input, status: "running", mutating: mutating.has(ev.name) }]);
        } else if (ev.type === "tool_end") {
          void (async () => {
            const images = (await Promise.all((ev.images ?? []).map((p) => backend.fileUrl(p).catch(() => "")))).filter(Boolean);
            patchTool(ev.id, { status: ev.error ? "error" : "done", error: ev.error, summary: summarize(ev.result), images, before: befores.get(ev.id) });
          })();
        } else if (ev.type === "refusal") update((items) => [...items, { kind: "notice", id: uid(), text: ev.explanation ?? t("assistant.refused"), tone: "error" }]);
      },
    });
    abort.current = null;
    setRunning(false);
    setConv((c) => ({
      messages: r.messages,
      items: [
        ...c.items,
        ...(r.status === "error" ? [{ kind: "notice" as const, id: uid(), text: r.error ?? "Error", tone: "error" as const }] : []),
        ...(r.status === "aborted" ? [{ kind: "notice" as const, id: uid(), text: t("assistant.stopped") }] : []),
        ...(r.status === "max_iterations" ? [{ kind: "notice" as const, id: uid(), text: t("assistant.maxIterations") }] : []),
      ],
    }));
  };

  const hasKey = !!apiKey;

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-ink-1" aria-label={t("assistant.title")}>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line pl-3 pr-1.5">
        <Bot size={15} className="text-agent" />
        <span className="text-sm font-semibold">{t("assistant.title")}</span>
        <select value={model} onChange={(e) => (setModel(e.target.value), write(MODEL_STORE, e.target.value))} aria-label={t("assistant.model")} className="ml-1 h-6 rounded bg-transparent px-1 text-2xs text-fg-muted outline-none hover:bg-ink-3">
          {MODELS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div className="ml-auto flex">
          <IconButton label={t("assistant.newChat")} disabled={running} onClick={() => setConv({ messages: [], items: [] })}>
            <SquarePen size={14} />
          </IconButton>
          <IconButton label={t("assistant.settings")} active={settings} onClick={() => setSettings((s) => !s)}>
            <Settings2 size={14} />
          </IconButton>
          <IconButton label={t("assistant.close")} onClick={() => ui.set({ assistant: false })}>
            <X size={14} />
          </IconButton>
        </div>
      </div>

      {(!hasKey || settings) && <KeySettings apiKey={apiKey} onSave={(k) => (setApiKey(k), write(KEY_STORE, k || null), setSettings(false))} />}

      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto px-3 py-3 text-sm">
        {!conv.items.length && hasKey && (
          <div className="space-y-2 pt-4 text-center">
            <div className="text-sm text-fg-muted">{t("assistant.emptyTitle")}</div>
            <div className="flex flex-col gap-1">
              {[t("assistant.example1"), t("assistant.example2"), t("assistant.example3")].map((ex) => (
                <button key={ex} type="button" onClick={() => setDraft(ex)} className="rounded-md border border-line px-2.5 py-1.5 text-left text-xs text-fg-muted hover:border-fg-faint hover:text-fg">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {conv.items.map((it) =>
          it.kind === "user" ? (
            <div key={it.id} className="ml-8 rounded-lg bg-accent/15 px-3 py-2 text-fg">
              {it.text}
            </div>
          ) : it.kind === "assistant" ? (
            <div key={it.id} className="leading-relaxed text-fg">
              <RichText text={it.text} />
            </div>
          ) : it.kind === "notice" ? (
            <div key={it.id} className={clsx("rounded-md px-2.5 py-1.5 text-xs", it.tone === "error" ? "bg-danger/10 text-danger" : "bg-ink-2 text-fg-muted")}>
              {it.text}
            </div>
          ) : (
            <div key={it.id} className={clsx("rounded-md border bg-ink-0/40", it.mutating && it.status === "done" ? "border-agent/30" : "border-line")}>
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                {it.status === "running" ? <Loader2 size={12} className="animate-spin text-fg-muted" /> : it.status === "error" ? <CircleAlert size={12} className="text-danger" /> : it.status === "undone" ? <RotateCcw size={12} className="text-fg-faint" /> : it.mutating ? <Pencil size={12} className="text-agent" /> : <Check size={12} className="text-fg-faint" />}
                <span className="font-mono text-2xs text-fg">{it.name}</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-fg-faint">{inputSummary(it.name, it.input)}</span>
                {it.mutating && it.status === "done" && it.before && (
                  <button
                    type="button"
                    onClick={() => {
                      store.replace(it.before!);
                      patchTool(it.id, { status: "undone" });
                    }}
                    className="rounded px-1.5 py-0.5 text-2xs font-medium text-accent hover:bg-ink-3"
                  >
                    {t("assistant.undo")}
                  </button>
                )}
              </div>
              {(it.summary || it.error) && <div className={clsx("border-t border-line/70 px-2.5 py-1 text-2xs", it.error ? "text-danger" : "text-fg-muted")}>{it.error ?? it.summary}</div>}
              {!!it.images?.length && (
                <div className={clsx("grid gap-px border-t border-line/70", it.images.length > 1 && "grid-cols-2")}>
                  {it.images.map((src) => (
                    <img key={src} src={src} alt={t("assistant.renderAlt")} className="checker-sm block w-full" />
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {running && (
          <div className="flex items-center gap-2 text-xs text-fg-muted">
            <Loader2 size={12} className="animate-spin" /> {t("assistant.working")}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <div className="flex items-end gap-1.5 rounded-lg border border-line bg-ink-2 p-1.5 focus-within:border-accent/60">
          <textarea
            value={draft}
            rows={2}
            disabled={!hasKey}
            placeholder={hasKey ? t("assistant.placeholder") : t("assistant.needKey")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-1 text-sm outline-none placeholder:text-fg-faint"
          />
          {running ? (
            <IconButton label={t("assistant.stop")} onClick={() => abort.current?.abort()}>
              <Square size={13} fill="currentColor" />
            </IconButton>
          ) : (
            <IconButton label={t("assistant.send")} disabled={!draft.trim() || !hasKey} onClick={() => void send()} className="text-accent">
              <Send size={14} />
            </IconButton>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1 px-1 text-2xs text-fg-faint">
          <Wrench size={10} /> {t("assistant.toolsCount", { n: tools.length })}
        </div>
      </div>
    </aside>
  );
}

function KeySettings({ apiKey, onSave }: { apiKey: string; onSave(k: string): void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(apiKey);
  const [show, setShow] = useState(false);
  return (
    <div className="shrink-0 space-y-2.5 border-b border-line bg-ink-0/40 p-3 text-xs">
      <div className="flex items-start gap-2">
        <KeyRound size={14} className="mt-0.5 shrink-0 text-key" />
        <div className="space-y-1 text-fg-muted">
          <p className="font-medium text-fg">{t("assistant.keyTitle")}</p>
          <p>{t("assistant.keyBody1")}</p>
          <p>{t("assistant.keyBody2")}</p>
        </div>
      </div>
      <div className="flex gap-1">
        <div className="relative flex-1">
          <input type={show ? "text" : "password"} value={value} onChange={(e) => setValue(e.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} aria-label={t("assistant.keyLabel")} className="field h-7 pr-7 font-mono" />
          <button type="button" aria-label={show ? t("assistant.hideKey") : t("assistant.showKey")} onClick={() => setShow((s) => !s)} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-faint hover:text-fg">
            {show ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <Button size="sm" variant="primary" disabled={!value.trim() || value.trim() === apiKey} onClick={() => onSave(value.trim())}>
          {t("assistant.saveKey")}
        </Button>
      </div>
      {apiKey && (
        <button type="button" onClick={() => (setValue(""), onSave(""))} className="text-2xs text-fg-faint hover:text-danger">
          {t("assistant.forgetKey")}
        </button>
      )}
    </div>
  );
}
