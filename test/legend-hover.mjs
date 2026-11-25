/**
 * Hovering a legend swatch must isolate that series in the chart.
 *
 * The chart has always isolated on segment hover. The legend below it only
 * reacted to clicks, so pointing at a colour did nothing — the reader had to
 * guess which swatch matched which slice. Both now drive one shared hover state.
 *
 *   node test/legend-hover.mjs
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

  const swatchCount = await page.evaluate(() => document.querySelectorAll('.tbi-swatchBtn').length);
  check('the legend renders swatches', swatchCount > 1, `${swatchCount} swatches`);
  if (swatchCount < 2) throw new Error('need at least two swatches to test isolation');

  /** Which model keys are currently dimmed in the chart, and which is lit. */
  const chartState = () => page.evaluate(() => {
    const slices = [...document.querySelectorAll('rect[data-model]')];
    const models = [...new Set(slices.map((s) => s.getAttribute('data-model')))];
    const muted = [...new Set(slices.filter((s) => s.getAttribute('data-muted') === 'true').map((s) => s.getAttribute('data-model')))];
    return { models, muted };
  });

  const before = await chartState();
  check('nothing is dimmed before any hover', before.muted.length === 0, JSON.stringify(before.muted));

  // Hover the first swatch.
  const firstSwatch = await page.evaluate(() => {
    const btn = document.querySelectorAll('.tbi-swatchBtn')[0];
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.mouse.move(firstSwatch.x, firstSwatch.y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));

  const during = await chartState();
  console.log(`chart models ${during.models.length}, dimmed after swatch hover: ${during.muted.length}`);
  check('hovering a swatch dims the other series in the chart',
    during.muted.length > 0 && during.muted.length < during.models.length,
    `dimmed ${during.muted.length} of ${during.models.length}`);

  // The swatch under the pointer must not itself read as muted.
  const swatchSelf = await page.evaluate(() => {
    const btn = document.querySelectorAll('.tbi-swatchBtn')[0];
    return { focus: btn.getAttribute('data-focus'), muted: btn.getAttribute('data-muted') };
  });
  check('the hovered swatch reads as focused, not muted',
    swatchSelf.focus === 'true' && swatchSelf.muted === 'false',
    JSON.stringify(swatchSelf));

  // Leaving the legend clears the preview.
  await page.mouse.move(5, 5);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  const after = await chartState();
  check('leaving the legend clears the isolation', after.muted.length === 0, JSON.stringify(after.muted));

  // Clicking still pins the focus, which is the separate behaviour it had.
  await page.mouse.move(firstSwatch.x, firstSwatch.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.mouse.move(5, 5);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
  const pinned = await chartState();
  check('a click still pins the isolation after the pointer leaves',
    pinned.muted.length > 0, `dimmed ${pinned.muted.length}`);
} finally {
  await harness.close();
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nlegend hover ok');