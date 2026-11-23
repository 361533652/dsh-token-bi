/**
 * Reorder motion probe: does the displaced card actually *travel* to its new
 * slot, or does it teleport there?
 *
 * The FLIP pass writes an inverse offset, forces a reflow, then releases the
 * inline styles so the element transitions back to its natural position. That
 * last step depends on a `transform` transition existing on the element — remove
 * it and the offset is dropped in one frame. Nothing throws; the animation is
 * simply gone. So this samples the displaced tile mid-flight.
 *
 *   node test/motion.mjs
 */
import { startHarness } from './browser/harness.mjs';

const harness = await startHarness();
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

const inspect = () => harness.page.evaluate(() => [...document.querySelectorAll('.tbi-figureTile')].map((tile) => {
  const rect = tile.getBoundingClientRect();
  return {
    label: tile.querySelector('.tbi-figureLabel')?.textContent ?? '',
    left: Math.round(rect.left * 100) / 100,
    top: Math.round(rect.top * 100) / 100,
    width: rect.width,
    height: rect.height,
    dragging: tile.dataset.dragging === 'true',
    transitionProperty: getComputedStyle(tile).transitionProperty,
    transitionDuration: getComputedStyle(tile).transitionDuration,
  };
}));

const frame = () => harness.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

try {
  await harness.open();
  const before = await inspect();
  const first = before[0];
  const slotWidth = first.width;
  const startX = first.left + first.width / 2;
  const startY = first.top + first.height / 2;

  // A resting tile must advertise a transform transition, or the FLIP release
  // has nothing to animate.
  check('a resting tile transitions transform',
    before[1].transitionProperty.includes('transform'),
    before[1].transitionProperty);
  check('the transition has a non-zero duration',
    parseFloat(before[1].transitionDuration) > 0,
    before[1].transitionDuration);

  await harness.page.mouse.move(startX, startY);
  await harness.page.mouse.down();
  await frame();

  // Cross into the neighbour: the neighbour is now displaced, and must travel.
  await harness.page.mouse.move(startX + slotWidth * 0.75, startY);
  await frame();

  // Sample every frame for a while and watch the *displaced* tile move.
  const displacedLabel = before[1].label;
  const positions = [];
  for (let index = 0; index < 45; index += 1) {
    const snapshot = await inspect();
    const tile = snapshot.find((entry) => entry.label === displacedLabel);
    positions.push(tile === undefined ? NaN : tile.left);
    await frame();
  }

  const finite = positions.filter((value) => Number.isFinite(value));
  const distinct = [...new Set(finite.map((value) => Math.round(value)))];
  console.log('displaced tile left positions across frames:', JSON.stringify(distinct));
  // A teleport shows one or two distinct positions; a real transition shows
  // several intermediate ones.
  check('the displaced tile travels through intermediate positions',
    distinct.length >= 3,
    `${distinct.length} distinct position(s)`);

  // And it must settle: no endless drift.
  const tail = positions.slice(-5).filter((value) => Number.isFinite(value));
  check('the displaced tile comes to rest',
    tail.every((value) => Math.abs(value - tail[tail.length - 1]) < 0.5),
    'still moving at the end');

  await harness.page.mouse.up();
} finally {
  await harness.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nreorder motion ok');