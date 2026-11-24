export default async ({ evaluate, wait, shot }) => {
  await evaluate("window.ready.then(()=>1)");
  const dir = process.env.FRAMES; const n = 14;
  let i = 0;
  const f = async (p) => { await evaluate(`setSplit(${p})`); await wait(60); await shot(`${dir}/${String(i++).padStart(3, "0")}.png`); };
  for (let k = 0; k <= n; k++) { const t = k / n; const e = t < .5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2; await f(0.02 + 0.96 * e); }
};
