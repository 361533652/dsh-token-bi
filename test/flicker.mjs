/**
 * Flicker probe: sample the painted board frame by frame across a whole drag,
 * including the frames after the drop.
 *
 * The acceptance suite checks end states and sparse samples, which a high
 * frequency wobble slips through. This records every animation frame.
 *
 *   node test/flicker.mjs
 */
import { startHarness } from './browser/harness.mjs';

const harness = await startHarness();
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

/** Every tile's painted box plus its live style, in DOM order. */
const inspect = () => harness.page.evaluate(() => [...document.querySelectorAll('.tbi-figureTile')].map((tile) => {
  const rect = tile.getBoundingClientRect();
  const label = tile.querySelector('.tbi-figureLabel')?.textContent ?? '';
  return {
    label,
    left: Math.round(rect.left * 100) / 100,
    top: Math.round(rect.top * 100) / 100,
    width: rect.width,
    height: rect.height,
    dragging: tile.dataset.dragging === 'true',
    transform: getComputedStyle(tile).transform,
    transition: getComputedStyle(tile).transitionDuration,
  };
}));

const frame = () => harness.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

try {
  await harness.open();
  const before = await inspect();
  const first = before[0];
  const pressX = first.left + first.width / 2;
  const pressY = first.top + first.height / 2;
  const slotWidth = first.width;

  await harness.page.mouse.move(pressX, pressY);
  await harness.page.mouse.down();
  await frame();

  // 3px per step, far enough to cross one slot and settle beyond it.
  const STEPS = 120;
  const samples = [];
  for (let step = 1; step <= STEPS; step += 1) {
    await harness.page.mouse.move(pressX + step * 3, pressY);
    await frame();
    samples.push(await inspect());
  }

  const liftedLabel = first.label;
  const lefts = samples.map((snapshot) => {
    const tile = snapshot.find((entry) => entry.label === liftedLabel);
    return tile === undefined ? NaN : tile.left;
  });
  const deltas = lefts.slice(1).map((value, index) => value - lefts[index]).filter((d) => Number.isFinite(d));
  console.log('per-frame deltas (px):', JSON.stringify(deltas.map((d) => Math.round(d))));

  const jumps = deltas.filter((delta) => delta > slotWidth * 0.5);
  const backs = deltas.filter((delta) => delta < -1);
  check('the lifted tile never jumps a slot while the pointer creeps',
    jumps.length === 0, jumps.length === 0 ? '' : `jumps: ${JSON.stringify(jumps.map((d) => Math.round(d)))}`);
  check('the lifted tile never goes backwards while the pointer moves right',
    backs.length === 0, backs.length === 0 ? '' : `backs: ${JSON.stringify(backs.map((d) => Math.round(d)))}`);

  const orders = samples.map((snapshot) => snapshot.map((tile) => tile.label).join(','));
  let reorders = 0;
  for (let index = 1; index < orders.length; index += 1) {
    if (orders[index] !== orders[index - 1]) reorders += 1;
  }
  const crossings = Math.floor((STEPS * 3) / slotWidth);
  console.log('reorders during the creep:', reorders, '| slot crossings:', crossings);
  check('the number of reorders matches the number of slots crossed',
    reorders <= crossings + 1, `${reorders} reorders for ~${crossings} crossings`);
  check('the order is stable once the pointer stops',
    new Set(orders.slice(-8)).size === 1, `${new Set(orders.slice(-8)).size} orders in the last 8 frames`);

  const stuckTransitions = samples.flatMap((snapshot) => snapshot
    .filter((tile) => tile.dragging && tile.transition !== '0s' && tile.transition !== 'none')
    .map((tile) => `${tile.label}:${tile.transition}`));
  check('the lifted tile never carries a transition', stuckTransitions.length === 0, stuckTransitions.slice(0, 3).join(' '));

  // ---- release ----
  await harness.page.mouse.up();

  const afterRelease = [];
  for (let index = 0; index < 20; index += 1) {
    await frame();
    afterRelease.push(await inspect());
  }
  const settled = afterRelease.at(-1);
  const settleOrders = new Set(afterRelease.map((snapshot) => snapshot.map((tile) => tile.label).join(',')));
  console.log('orders during 20 frames after release:', settleOrders.size);
  check('releasing does not reorder anything', settleOrders.size === 1, `${settleOrders.size} orders`);

  const leftovers = settled.filter((tile) => tile.transform !== 'none' && !tile.dragging);
  check('no tile keeps a transform after the drop',
    leftovers.length === 0,
    leftovers.map((tile) => `${tile.label}=${tile.transform}`).slice(0, 3).join(' '));

  const columns = [...new Set(settled.map((tile) => Math.round(tile.left)))].sort((a, b) => a - b);
  console.log('final column lefts:', JSON.stringify(columns));
  check('the board ends on a clean four-column grid', columns.length === 4, `${columns.length} column(s)`);

  const idle = [];
  for (let index = 0; index < 30; index += 1) {
    await frame();
    idle.push(await inspect());
  }
  const idleLayouts = new Set(idle.map((snapshot) => snapshot.map((tile) => Math.round(tile.left)).join(',')));
  console.log('distinct idle layouts:', idleLayouts.size);
  check('nothing keeps drifting after the drop', idleLayouts.size === 1, `${idleLayouts.size} layouts`);
} finally {
  await harness.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nno flicker');