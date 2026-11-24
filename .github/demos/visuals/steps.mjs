// Steps from env STEPS: JSON array of ["wait",ms] | ["click",x,y] | ["dbl",x,y] | ["key",key,code,mods] | ["eval",js] | ["shot",file] | ["dump"]
export default async ({ evaluate, wait, click, mouse, key, shot, out }) => {
  const steps = JSON.parse(process.env.STEPS);
  for (const s of steps) {
    const [op, ...a] = s;
    if (op === "wait") await wait(a[0]);
    else if (op === "click") { await click(a[0], a[1]); await wait(400); }
    else if (op === "altclick") { await mouse("mouseMoved", a[0], a[1], { button: "none", modifiers: 1 }); await mouse("mousePressed", a[0], a[1], { modifiers: 1 }); await mouse("mouseReleased", a[0], a[1], { modifiers: 1 }); await wait(400); }
    else if (op === "key") { await key(a[0], a[1] ?? a[0], a[2] ?? 0); await wait(300); }
    else if (op === "eval") console.log(await evaluate(a[0]));
    else if (op === "shot") await shot(a[0] ?? out);
    else if (op === "dump") console.log(await evaluate(`JSON.stringify([...document.querySelectorAll('button,[role=tab],input,select')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.y<900}).map(b=>{const r=b.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2),(b.title||b.getAttribute('aria-label')||b.textContent||b.value||'').trim().slice(0,40)]}))`));
  }
};
