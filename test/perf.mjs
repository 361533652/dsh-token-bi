/**
 * Frame-time probe for the drag hot path.
 *
 * Reports the longest frame gap while a card is dragged across several slots.
 * A heavy swap forces layout on every commit, which shows up as a long frame —
 * the "pause before the card moves" the reader sees.
 *
 *   node test/perf.mjs
 */
import { startHarness } from './browser/harness.mjs';

const harness = await startHarness();
try {
  await harness.open();
  const page = harness.page;

  const geo = await page.evaluate(() => [...document.querySelectorAll('.tbi-figureTile')].map((tile) => {
    const r = tile.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }));
  const first = geo[0];
  const startX = Math.round(first.left + first.width / 2);
  const startY = Math.round(first.top + first.height / 2);
  const slot = Math.round(first.width + 12);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

  // Record frame intervals for the whole sweep.
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    window.__stop = false;
    const tick = () => {
      const now = performance.now();
      window.__frames.push(now - last);
      last = now;
      if (!window.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Sweep across the whole row, one slot at a time, 6 swaps.
  for (let i = 1; i <= 3; i += 1) {
    await page.mouse.move(startX + slot * i, startY, { steps: 8 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }
  for (let i = 1; i <= 3; i += 1) {
    await page.mouse.move(startX + slot * (3 - i), startY, { steps: 8 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }

  const frames = await page.evaluate(() => { window.__stop = true; return window.__frames; });
  await page.mouse.up();

  const sorted = [...frames].sort((a, b) => b - a);
  const worst = sorted.slice(0, 5).map((v) => Math.round(v));
  const median = frames.length === 0 ? 0 : [...frames].sort((a, b) => a - b)[Math.floor(frames.length / 2)];
  console.log(`frames sampled: ${frames.length}`);
  console.log(`median frame: ${median.toFixed(1)}ms`);
  console.log(`worst 5 frames: ${JSON.stringify(worst)}ms`);
  const over = frames.filter((v) => v > 50).length;
  console.log(`frames over 50ms: ${over}`);
  if (over > 0) {
    console.error(`JANK: ${over} frame(s) exceeded 50ms`);
    process.exitCode = 1;
  } else {
    console.log('\nno long frames while dragging');
  }
} finally {
  await harness.close();
}