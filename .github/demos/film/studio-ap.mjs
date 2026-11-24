export default async ({ sleep, shot, click, moveTo, drag, startRec, stopRec, ensureCursor, evaluate }) => {
  await sleep(5000); await ensureCursor(); await evaluate("__curMove(760,620)"); await sleep(300);
  await startRec(); await sleep(900);
  await click(1712,179, 900); await sleep(900);              // select the photo layer
  await click(1792,369, 700); await sleep(1100);             // Looks tab
  await moveTo(1690,636, 500); await sleep(200);
  await click(1690,636, 300); await sleep(1700);             // Noir
  await click(1839,896, 700); await sleep(1900);             // Warm
  await click(1729,369, 700); await sleep(1000);             // Filters tab
  await drag(1782,577, 1850,577, 1100); await sleep(1100);   // clarity up
  await click(1712,178, 800); await sleep(900);              // select the title
  await drag(380,480, 430,455, 1100); await sleep(500);      // move it
  await drag(430,455, 380,480, 900); await sleep(900);
  await click(1766,22, 900); await sleep(2200);              // Export dialog
  await click(1297,357, 700); await sleep(1500);             // WebP
  await click(675,773, 700); await sleep(2600);              // quick export: square
  await stopRec("studio");
  await shot("studio-end.png");
};
