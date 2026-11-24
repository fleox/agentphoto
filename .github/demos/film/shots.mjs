import { readFileSync } from "node:fs";
export default async ({ send, navigate, sleep, shot, evaluate }) => {
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const jobs = JSON.parse(readFileSync(process.env.JOBS, "utf8"));
  for (const [q, out] of jobs) { await navigate("file:///tmp/ap-film/cards/cards.html?" + q); await evaluate("document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>0))))"); await sleep(150); await shot(out); }
};
