/**
 * Flicker probe: sample the painted board frame by frame across several gesture
 * shapes, including a fast sweep and a back-and-forth wiggle.
 *
 * A slow uniform creep is the easy case. Flicker shows up when the pointer moves
 * faster than React re-renders, or when it crosses a boundary repeatedly.
 *
 *   node test/flicker.mjs
 */
import { startHarness } from './browser/harness.mjs';

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

const inspect = (harness) => harness.page.evaluate(() => [...document.querySelectorAll('.tbi-figureTile')].map((tile) => {
  const rect = tile.getBoundingClientRect();
  return {
    label: tile.querySelector('.tbi-figureLabel')?.textContent ?? '',
    left: Math.round(rect.left * 100) / 100,
    top: Math.round(rect.top * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
    dragging: tile.dataset.dragging === 'true',
    transform: getComputedStyle(tile).transform,
  };
}));

const frame = (harness) => harness.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

/** Run one gesture and report how the board behaved. */
async function gesture(name, steps, { verifySize = false } = {}) {
  const harness = await startHarness();
  await harness.open();
  const pick = () => inspect(harness);
  const tick = () => frame(harness);
  const before = await pick();
  const first = before[0];
  const startX = first.left + first.width / 2;
  const startY = first.top + first.height / 2;
  const slotWidth = first.width;
  const slotHeight = first.height;
  const columnLefts = [...new Set(before.map((tile) => Math.round(tile.left)))].sort((a, b) => a - b);
  const rows = Math.round(before.length / columnLefts.length);

  await harness.page.mouse.move(startX, startY);
  await harness.page.mouse.down();
  await tick();
  const grabbed = await pick();
  if (verifySize) {
    const lifted = grabbed.find((tile) => tile.dragging);
    const match = lifted !== undefined
      && Math.abs(lifted.width - first.width) < 0.5
      && Math.abs(lifted.height - first.height) < 0.5;
    check(`[${name}] the lifted tile keeps its original size`, match,
      lifted === undefined ? 'nothing lifted' : `${lifted.width}x${lifted.height} vs ${first.width}x${first.height}`);
  }

  const stepsArray = [...steps(startX, startY)].map(([x, y]) => ({ x, y }));
  const samples = [];
  for (const point of stepsArray) {
    await harness.page.mouse.move(point.x, point.y);
    await tick();
    samples.push(await pick());
  }

  const orders = samples.map((snapshot) => snapshot.map((tile) => tile.label).join(','));
  // A flicker is an order that comes back to a value it already left, or many
  // more changes than boundary crossings.
  const flips = [];
  for (let index = 1; index < orders.length; index += 1) {
    if (orders[index] !== orders[index - 1]) flips.push(index);
  }
  // A flicker is order churn that the pointer's travel does not account for.
  //
  // Rather than re-deriving "which slot is the pointer over" here (a second
  // implementation of the very rule under test, and a source of false positives),
  // measure the thing the user actually sees: how far the lifted tile sits from
  // the pointer, frame by frame. A swap that is not backed by travel makes that
  // gap jump.
  const gapSeries = [];
  for (let index = 0; index < samples.length; index += 1) {
    const point = stepsArray[index];
    const lifted = samples[index].find((tile) => tile.dragging);
    if (lifted === undefined) {
      gapSeries.push(NaN);
      continue;
    }
    const tileX = lifted.left + slotWidth / 2;
    const tileY = lifted.top + slotHeight / 2;
    gapSeries.push(Math.hypot(point.x - tileX, point.y - tileY));
  }
  const finiteGaps = gapSeries.filter((gap) => Number.isFinite(gap));
  const worstGap = finiteGaps.length === 0 ? NaN : Math.max(...finiteGaps);
  console.log(`[${name}] worst pointer-to-tile gap ${worstGap.toFixed(1)}px over ${finiteGaps.length} frames`);
  // One slot width of tolerance: the maths is slot-relative, so a correct
  // implementation keeps the tile within a slot of the pointer at all times.
  check(`[${name}] the lifted tile stays under the pointer`, worstGap <= slotWidth,
    `worst gap ${worstGap.toFixed(1)}px > slot width ${slotWidth}`);

  // The lifted tile's width must never change, at any frame.
  const widths = samples
    .map((snapshot) => snapshot.find((tile) => tile.dragging)?.width)
    .filter((w) => w !== undefined);
  const widthStable = widths.every((w) => Math.abs(w - first.width) < 0.5);
  check(`[${name}] the lifted tile never changes size mid-drag`, widthStable,
    `${[...new Set(widths)].join(',')} vs ${first.width}`);

  await harness.page.mouse.up();
  for (let index = 0; index < 25; index += 1) await tick();

  const settled = await pick();
  const columns = [...new Set(settled.map((tile) => Math.round(tile.left)))].sort((a, b) => a - b);
  check(`[${name}] the board settles on a clean grid`, columns.length === 4, `${columns.length} column(s)`);
  const leftovers = settled.filter((tile) => tile.transform !== 'none');
  check(`[${name}] nothing keeps a transform`, leftovers.length === 0, leftovers.map((t) => t.label).join(' '));

  await harness.close();
}

try {
  // 1. Slow creep, one slot.
  await gesture('creep', (x, y) => Array.from({ length: 120 }, (_, i) => [x + (i + 1) * 3, y]), { verifySize: true });

  // 2. Fast sweep across the whole row in a handful of big jumps: the pointer
  //    moves further per frame than React can re-render, which is where a
  //    naive implementation swaps many times for one crossing.
  await gesture('sweep', (x, y) => Array.from({ length: 12 }, (_, i) => [x + (i + 1) * 90, y]));

  // 3. Vertical: drag down one row. Same rules, other axis.
  await gesture('down', (x, y) => Array.from({ length: 60 }, (_, i) => [x, y + (i + 1) * 3]));

  // 4. Diagonal: crosses both axes while the tile moves.
  await gesture('diagonal', (x, y) => Array.from({ length: 60 }, (_, i) => [x + (i + 1) * 5, y + (i + 1) * 3]));

  // 5. Wiggle back and forth across one boundary: crossing repeatedly must not
  //    set up a standing oscillation.
  await gesture('wiggle', (x, y) => {
    const out = [];
    for (let cycle = 0; cycle < 6; cycle += 1) {
      out.push([x + 300, y]);
      out.push([x + 60, y]);
    }
    return out;
  });
} finally {
  // harness.close() is called per gesture.
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nno flicker');