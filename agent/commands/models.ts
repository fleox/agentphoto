import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODELS, modelDef } from "../../src/core/catalog";
import { readLibraryIndex } from "../host";
import { CliError, printResult } from "../output";
import { modelsDir } from "../paths";
import { listCachedModels, modelCacheDir } from "../render/models";
import type { Command } from "./types";
import { confirmOrPlan, positional, table, usage, YES_OPTION } from "./util";

// Local AI models (catalog MODELS): downloaded once from Hugging Face into
// ~/.cache/agentphoto/models ($AGENTPHOTO_MODELS) through the engine's
// /__models/ proxy, then used offline.

const log = (m: string) => void process.stderr.write(`${m}\n`);

function unknownModel(id: string): never {
  throw new CliError("notFound", `Unknown model "${id}".`, `Models: ${MODELS.map((m) => m.id).join(", ")} (\`agentphoto models list\`).`, 2);
}

export const modelsCommand: Command = {
  name: "models",
  usage: "models <list|pull|remove> [<id>] [--yes]",
  summary: `Local AI models (background removal, Segment Anything): list them with their cache state, pre-download one (pull — otherwise the first remove-bg / mask generate downloads it), or delete its cache. Cache: ${"~/.cache/agentphoto/models"} ($AGENTPHOTO_MODELS overrides).`,
  subcommands: [
    { name: "list", usage: "models list", summary: "Every model: id, task, download size, licence, whether it is cached (and its size on disk)." },
    { name: "pull", usage: "models pull <id>", summary: "Download a model now by running it once on a sample photo (needs Chrome and the network)." },
    { name: "remove", usage: "models remove <id> [--yes]", summary: "Delete a model's cache folder (plan + needsConfirmation unless --yes).", destructive: true },
  ],
  options: [YES_OPTION],
  async run({ io, options, positionals }) {
    const [action = "list", id] = positionals;
    if (action === "list") {
      const models = listCachedModels();
      return printResult(io, { dir: modelsDir(), models }, () => `${table(models.map((m) => ({ ...m, cached: m.cached ? `yes (${m.cachedMb} MB)` : "no" })) as unknown as Record<string, unknown>[], ["id", "task", "sizeMb", "cached", "license"])}\nCache: ${modelsDir()}`);
    }
    if (action === "pull") {
      const mid = positional(positionals, 1, "model id", "models pull <id>");
      const def = modelDef(mid) ?? unknownModel(mid);
      const sample = readLibraryIndex().assets.find((a) => a.kind === "image" && a.width && a.height);
      if (!sample) throw new CliError("library-missing", "No sample photo in the library to run the model on.", "Reinstall the package (library/ ships the sample photos).");
      const W = sample.width!;
      const H = sample.height!;
      const doc = { version: 1, id: "pull", canvas: { width: W, height: H }, layers: [{ id: "photo", type: "image", src: `library:${sample.id}`, x: 0, y: 0, width: W, height: H }] };
      const dir = mkdtempSync(join(tmpdir(), "agentphoto-pull-"));
      const { EngineSession } = await import("../render/session");
      const session = new EngineSession(dir);
      const t0 = Date.now();
      try {
        log(`Pulling ${def.id} (${def.repo}, ~${def.sizeMb} MB)…`);
        if (def.task === "segmentation") await session.call("segmentMask", doc, "photo", { points: [[W / 2, H / 2, 1]] }, { model: def.id });
        else await session.call("backgroundMask", doc, "photo", { model: def.id });
      } finally {
        await session.close();
        rmSync(dir, { recursive: true, force: true });
      }
      const m = listCachedModels().find((x) => x.id === def.id)!;
      return printResult(io, { model: m, seconds: Math.round((Date.now() - t0) / 100) / 10 }, () => `${def.id} is ready (${m.cachedMb} MB in ${m.dir}).`);
    }
    if (action === "remove") {
      const mid = positional(positionals, 1, "model id", "models remove <id>");
      const def = modelDef(mid) ?? unknownModel(mid);
      const m = listCachedModels().find((x) => x.id === def.id)!;
      if (!m.cached) return printResult(io, { removed: false, model: m }, () => `${def.id} is not cached.`);
      if (!confirmOrPlan(io, options, { remove: modelCacheDir(def), model: def.id, mb: m.cachedMb }, () => `Delete ${modelCacheDir(def)} (${m.cachedMb} MB). It downloads again on next use.`)) return;
      rmSync(modelCacheDir(def), { recursive: true, force: true });
      return printResult(io, { removed: true, model: def.id, dir: modelCacheDir(def), freedMb: m.cachedMb }, () => `Removed ${def.id} (${m.cachedMb} MB freed).`);
    }
    void id;
    usage(`Unknown models action "${action}".`, "Use list, pull or remove.");
  },
};
