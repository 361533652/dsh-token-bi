/**
 * Does the pushed card ever *appear* somewhere it should not before animating?
 *
 * A correct FLIP paints the card at its old slot, then walks it to the new one.
 * If the inverse offset is computed against stale layout, or omitted, the card is
 * briefly drawn a whole slot away — a flash the reader sees even though the final
 * positions are right.
 *
 * This records the pushed card's painted left edge on every frame from the swap
 * onwards and rejects any position outside the corridor between the two slots.
 *
 *   node test/preshift.mjs
 */
import { startHarness } from './browser/harness.mjs';

const harness = await startHarness();
let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

try {
  await harness.open();
  const page = harness.page;

  const geometry = await page.evaluate(() => [...document.querySelectorAll('.tbi-figureTile')].map((tile) => {
    const r = tile.getBoundingClientRect();
    return {
      label: tile.querySelector('.tbi-figureLabel')?.textContent ?? '',
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }));

  const first = geometry[0];
  const pushed = geometry[1];
  const startX = Math.round(first.left + first.width / 2);
  const startY = Math.round(first.top + first.height / 2);

  /** The pushed card's painted left edge, right now. */
  const pushedLeft = () => page.evaluate((label) => {
    const tile = [...document.querySelectorAll('.tbi-figureTile')]
      .find((entry) => (entry.querySelector('.tbi-figureLabel')?.textContent ?? '') === label);
    return tile === null || tile === undefined ? null : Math.round(tile.getBoundingClientRect().left);
  }, pushed.label);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  await page.mouse.move(startX + Math.round(first.width * 0.75), startY);

  const frames = [];
  for (let index = 0; index < 30; index += 1) {
    frames.push(await pushedLeft());
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  }

  const origin = pushed.left;
  const destination = first.left;
  const lo = Math.min(origin, destination) - 8;
  const hi = Math.max(origin, destination) + 8;
  console.log(`pushed card ${origin} -> ${destination} | corridor ${lo}..${hi}`);
  console.log('frames:', JSON.stringify(frames));

  const outside = frames.filter((left) => left !== null && (left < lo || left > hi));
  check('the pushed card never paints outside the corridor between the slots',
    outside.length === 0,
    outside.length === 0 ? '' : `escaped to ${JSON.stringify(outside.slice(0, 5))}`);

  const firstPainted = frames[0];
  check('the pushed card starts at its origin, not the destination',
    firstPainted !== null && Math.abs(firstPainted - origin) <= 8,
    `first frame at ${firstPainted}, origin ${origin}`);

  const trail = [...new Set(frames.filter((left) => left !== null))];
  check('the pushed card animates through several positions', trail.length >= 4, `${trail.length} distinct`);
  check('the pushed card lands on the destination',
    Math.abs(frames[frames.length - 1] - destination) <= 8,
    `ended at ${frames[frames.length - 1]}, expected ${destination}`);

  await page.mouse.up();
} finally {
  await harness.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nno pre-animation flash');