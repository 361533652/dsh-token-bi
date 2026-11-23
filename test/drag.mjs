/**
 * The card drag-reorder acceptance suite — in a real browser.
 *
 * ## Why this file exists
 *
 * `test/render.mjs` renders the panel into a hand-rolled React stand-in with no
 * DOM and no layout. It can prove that `client.js` *contains* a `translate()`,
 * that a `mousemove` listener is registered, and that the string
 * `toIndex > fromIndex ? 1 : -1` appears in a function body. It cannot prove the
 * tile moves, because in that harness `getBoundingClientRect()` returns zeroes
 * and nothing is ever painted.
 *
 * That gap is not theoretical: the drag was rejected six times with the old
 * suite green. Every assertion below is therefore chosen so that it **fails on
 * "the code looks right"** and passes only on "the reader sees it right".
 *
 * ## What "correct" means here (the contract being tested)
 *
 *   1. idle      —eight tiles, a real 4x2 grid, a real stylesheet;
 *   2. press     —the pressed tile lifts (shadow, z-index, cursor) and nothing
 *                  else moves; pressing and releasing without moving the pointer
 *                  changes nothing and persists nothing;
 *   3. track     —while the pointer moves *inside one slot*, the tile's painted
 *                  left/top changes by exactly the pointer's delta. No lag, no
 *                  snapping, no scale-only "lift";
 *   4. swap      —crossing into a neighbour's slot trades the two *while* the
 *                  drag continues, and —this is the one that has always been
 *                  missing —the lifted tile keeps sitting under the pointer
 *                  afterwards, instead of jumping away by a slot;
 *   5. continuous —a pointer that crosses three slots performs three swaps, in
 *                  order, and the painted order changes during the gesture
 *                  rather than at the drop;
 *   6. still     —with the pointer held motionless the board stops moving: no
 *                  oscillating swap-back, no drift;
 *   7. release   —letting go settles the tile into the slot under the pointer,
 *                  ends the drag state, and leaves no later motion;
 *   8. persist   —the persisted order round-trips: reloading with it gives the
 *                  same painted board, and a card the stored order omits still
 *                  appears;
 *   9. contain   —the lifted tile stays inside the grid's visible box, so the
 *                  reader can always see what they are dragging.
 *
 * Run:  node test/drag.mjs [--only=track,swap] [--headed] [--report=path.json]
 */

import { writeFileSync } from 'node:fs';
import { startHarness } from './browser/harness.mjs';
import { cardBox, dragThrough, readBoard, releasePointer, installRecorder } from './browser/drag.mjs';

//#region tiny reporter
const args = process.argv.slice(2);
const only = (() => {
  const hit = args.find((arg) => arg.startsWith('--only='));
  return hit === undefined ? null : new Set(hit.slice('--only='.length).split(',').map((name) => name.trim()));
})();
const reportPath = (() => {
  const hit = args.find((arg) => arg.startsWith('--report='));
  return hit === undefined ? null : hit.slice('--report='.length);
})();
const headed = args.includes('--headed');

const results = [];
let currentGroup = '';

function group(name) {
  currentGroup = name;
  console.log(`\n${name}`);
}

/**
 * Record one assertion.
 *
 * `detail` is printed either way: a green line that says only "ok" is how six
 * broken revisions passed a green suite. Every check states the number it
 * measured.
 */
function check(name, pass, detail) {
  results.push({ group: currentGroup, name, pass: pass === true, detail: String(detail ?? '') });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  [${detail}]`}`);
  return pass === true;
}

const fmt = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : String(value));

/** The distance between the lifted tile's centre and the pointer. */
function pointerGap(row) {
  if (row?.lifted === null || row?.lifted === undefined || row?.pointer === null) return null;
  return {
    x: row.lifted.center.x - row.pointer.x,
    y: row.lifted.center.y - row.pointer.y,
  };
}

/** Fingerprint of a resting board, for "nothing moved" comparisons. */
function boardPrint(rest) {
  return rest.tiles.map((tile) => `${tile.label}@${tile.left.toFixed(1)},${tile.top.toFixed(1)}`).join('|');
}

// The suite drives the default 4-column layout unless a scenario says otherwise.
const CARDS = 8;
//#endregion

//#region scenarios
async function scenarioIdle() {
  const harness = await startHarness();
  await harness.open({ headed, viewport: { width: 1280, height: 900 } });
  try {
    const board = await readBoard(harness.page);
    const rest = board.rest;

    check('eight draggable tiles are painted',
      rest.tiles.length === CARDS,
      `${rest.tiles.length} tiles`);

    check('the grid has four real columns, not a stack of zero-width boxes',
      new Set(rest.tiles.slice(0, 4).map((tile) => Math.round(tile.left))).size === 4,
      rest.tiles.slice(0, 4).map((tile) => Math.round(tile.left)).join(','));

    check('the second row sits below the first',
      Math.min(...rest.tiles.slice(4).map((tile) => tile.top)) > Math.max(...rest.tiles.slice(0, 4).map((tile) => tile.top)),
      `row1 top=${fmt(rest.tiles[0].top)}, row2 top=${fmt(rest.tiles[4].top)}`);

    check('every tile has a non-zero painted box',
      rest.tiles.every((tile) => tile.width > 40 && tile.height > 40),
      `${fmt(rest.tiles[0].width)}x${fmt(rest.tiles[0].height)}`);

    check('no tile is lifted before a gesture',
      rest.tiles.every((tile) => tile.dragging === false) && rest.sorting !== 'true',
      `dragging count=${rest.tiles.filter((tile) => tile.dragging).length}, sorting=${rest.sorting}`);

    check('the stylesheet is applied (grab cursor on a resting tile)',
      rest.tiles.some((tile) => rest.tiles[0] !== undefined) && (await harness.page.evaluate(() => {
        const first = document.querySelector('.tbi-figureTile');
        return first === null ? null : getComputedStyle(first).cursor;
      })) === 'grab',
      await harness.page.evaluate(() => getComputedStyle(document.querySelector('.tbi-figureTile')).cursor));

    check('the panel persisted nothing while idle',
      board.writes.length === 0,
      `${board.writes.length} writes`);

    check('the panel logged no runtime error',
      board.errors.length === 0,
      board.errors.length === 0 ? 'none' : board.errors[0].slice(0, 120));

    check('the page itself threw nothing',
      harness.pageErrors.length === 0,
      harness.pageErrors.length === 0 ? 'none' : harness.pageErrors[0].slice(0, 120));
  } finally {
    await harness.close();
  }
}

async function scenarioPress() {
  const harness = await startHarness();
  await harness.open({ headed });
  try {
    await installRecorder(harness.page);
    const board = await readBoard(harness.page);
    const before = board.rest;
    const orderBefore = before.order.slice();

    const target = before.tiles[0];
    const start = await cardBox(harness.page, target.label);
    await harness.page.mouse.move(start.x, start.y);
    await harness.page.mouse.down();
    await harness.page.evaluate(() => window.__TBI_DRAG__.settle());
    const pressed = await harness.page.evaluate(() => window.__TBI_DRAG__.rest());

    const lifted = pressed.tiles.filter((tile) => tile.dragging);
    check('pressing a card lifts exactly one tile',
      lifted.length === 1,
      `${lifted.length} lifted`);

    check('the lifted tile is the one under the pointer',
      lifted[0]?.label === target.label,
      `${lifted[0]?.label} vs pressed ${target.label}`);

    check('the grid announces that a sort is in progress',
      pressed.sorting === 'true',
      `data-sorting=${pressed.sorting}`);

    const liftedStyle = await harness.page.evaluate(() => {
      const element = document.querySelector('.tbi-figureTile[data-dragging=true]');
      if (element === null) return null;
      const style = getComputedStyle(element);
      return {
        zIndex: style.zIndex,
        cursor: style.cursor,
        boxShadow: style.boxShadow,
        transitionProperty: style.transitionProperty,
      };
    });
    check('the lifted tile is raised above its neighbours',
      liftedStyle !== null && Number(liftedStyle.zIndex) > 0,
      `z-index=${liftedStyle?.zIndex}`);
    check('the cursor changes to grabbing',
      liftedStyle?.cursor === 'grabbing',
      liftedStyle?.cursor);
    check('the lifted tile casts a shadow, so it reads as lifted',
      liftedStyle !== null && liftedStyle.boxShadow !== 'none',
      liftedStyle?.boxShadow?.slice(0, 40));
    check('the lifted tile has no transition, so it cannot lag the pointer',
      liftedStyle !== null && (liftedStyle.transitionProperty === 'none' || liftedStyle.transitionDuration === '0s'),
      `transition-property=${liftedStyle?.transitionProperty}, duration=${liftedStyle?.transitionDuration}`);

    check('pressing alone did not reorder the board',
      pressed.order.join() === orderBefore.join(),
      pressed.order.join(' '));

    // Hold, then release without ever moving.
    await harness.page.waitForTimeout(140);
    await harness.page.mouse.up();
    await harness.page.evaluate(() => window.__TBI_DRAG__.settle());
    const after = await readBoard(harness.page);

    check('pressing and releasing without moving leaves the board untouched',
      after.rest.order.join() === orderBefore.join(),
      after.rest.order.join(' '));

    check('pressing and releasing persists nothing',
      after.writes.length === 0,
      `${after.writes.length} writes`);

    check('after release no tile is still lifted',
      after.rest.tiles.every((tile) => tile.dragging === false) && after.rest.sorting !== 'true',
      `dragging=${after.rest.tiles.filter((tile) => tile.dragging).length}, sorting=${after.rest.sorting}`);

    check('pressing and releasing does not move any tile',
      boardPrint(after.rest) === boardPrint(before),
      'positions unchanged');
  } finally {
    await harness.close();
  }
}

/**
 * The tracking contract: inside one slot, the tile is the pointer.
 *
 * This is the assertion that would have caught the very first rejected
 * revision, where the tile only scaled to 96% and stayed put. It reads
 * `getBoundingClientRect()` —the painted box —so a transform that is set on
 * the element but never painted still fails.
 */
async function scenarioTrack() {
  const harness = await startHarness();
  await harness.open({ headed });
  try {
    await installRecorder(harness.page);
    const board = await readBoard(harness.page);
    const tiles = board.rest.tiles;
    const target = tiles[0];
    const start = await cardBox(harness.page, target.label);

    await harness.page.mouse.move(start.x, start.y);
    await harness.page.mouse.down();
    await harness.page.evaluate(() => window.__TBI_DRAG__.settle());

    // Well inside the tile, so no slot boundary is crossed and no swap is due.
    const deltas = [
      { dx: 24, dy: 14 },
      { dx: 52, dy: -9 },
      { dx: -38, dy: 26 },
      { dx: 6, dy: 4 },
    ];
    const rows = [];
    for (const delta of deltas) {
      await harness.page.mouse.move(start.x + delta.dx, start.y + delta.dy, { steps: 6 });
      await harness.page.evaluate(() => window.__TBI_DRAG__.settle());
      const row = await harness.page.evaluate(() => window.__TBI_DRAG__.rest());
      const lifted = row.tiles.find((tile) => tile.dragging);
      rows.push({ delta, lifted, order: row.order });
    }

    const referenceLeft = target.left;
    const referenceTop = target.top;
    let worst = 0;
    for (const { delta, lifted } of rows) {
      if (lifted === undefined) {
        check('the tile stayed lifted through a sub-slot move', false, 'no lifted tile');
        continue;
      }
      // Transform is scaled 1.04, so the painted box grows by 2% per side; the
      // centre is scale-invariant and is what the eye tracks.
      const movedX = lifted.center.x - (referenceLeft + target.width / 2);
      const movedY = lifted.center.y - (referenceTop + target.height / 2);
      worst = Math.max(worst, Math.abs(movedX - delta.dx), Math.abs(movedY - delta.dy));
    }

    check('the tile follows the pointer one-for-one inside its own slot',
      worst <= 2,
      `largest deviation from the pointer delta: ${fmt(worst)}px over ${deltas.length} moves`);

    check('sub-slot tracking never reorders the board',
      rows.every((row) => row.order.join() === board.rest.order.join()),
      rows.at(-1).order.join(' '));

    check('the dragged transform is a translate, not a bare scale',
      await harness.page.evaluate(() => {
        const element = document.querySelector('.tbi-figureTile[data-dragging=true]');
        const transform = element === null ? '' : getComputedStyle(element).transform;
        // A translate always carries a non-zero m41/m42 pair; a scale-only
        // matrix has zeroes there, which is the "it looks like it's dragging
        // but nothing moves" defect verbatim.
        if (!transform.startsWith('matrix(')) return false;
        const parts = transform.slice(7, -1).split(',').map(Number);
        return Math.abs(parts[4]) > 1 || Math.abs(parts[5]) > 1;
      }),
      'matrix has a non-zero translation component');

    await harness.page.mouse.up();
    await harness.page.evaluate(() => window.__TBI_DRAG__.settle());
  } finally {
    await harness.close();
  }
}

/**
 * One slot, in both directions: swap while dragging, and stay under the pointer.
 *
 * The second half is the assertion the previous suite could not make. A tile
 * that swaps its DOM position AND keeps its old translate is drawn a full slot
 * away from the cursor —the drag reads as broken even though the order is
 * right, which is exactly the "order changed but it felt wrong" feedback.
 */
async function scenarioSwap() {
  for (const direction of ['right', 'left']) {
    const harness = await startHarness();
    await harness.open({ headed });
    try {
      await installRecorder(harness.page);
      const board = await readBoard(harness.page);
      const tiles = board.rest.tiles;
      const fromIndex = direction === 'right' ? 0 : 1;
      const toIndex = direction === 'right' ? 1 : 0;
      const target = tiles[fromIndex];

      const press = await dragThrough(harness.page, {
        label: target.label,
        waypoints: [{ x: tiles[toIndex].center.x, y: tiles[toIndex].center.y }],
        steps: 12,
      });

      const during = press.trace.at(-1);
      check(`[${direction}] crossing into a neighbour swaps during the gesture, not at the drop`,
        during.order.indexOf(target.label) === toIndex,
        `painted order: ${during.order.join(' ')}`);

      check(`[${direction}] the neighbour moved to the vacated slot`,
        during.order.indexOf(tiles[toIndex].label) === fromIndex,
        `${tiles[toIndex].label} -> index ${during.order.indexOf(tiles[toIndex].label)}`);

      // The tile must still be under the finger.
      const gap = pointerGap(during);
      const slotWidth = tiles[0].width;
      check(`[${direction}] after swapping, the lifted tile is still under the pointer`,
        gap !== null && Math.abs(gap.x) <= slotWidth * 0.35,
        gap === null ? 'no lifted tile' : `pointer-to-tile gap ${fmt(gap.x)}px (slot width ${fmt(slotWidth)}px)`);

      const release = await releasePointer(harness.page);
      check(`[${direction}] releasing keeps the swapped order`,
        release.rest.order.indexOf(target.label) === toIndex,
        release.rest.order.join(' '));

      check(`[${direction}] the swap was persisted exactly once`,
        release.writes.length === 1,
        `${release.writes.length} writes, last=${JSON.stringify(release.writes.at(-1))}`);

      check(`[${direction}] nothing moves after the pointer is released`,
        release.still.every((frame) => frame.order.join() === release.rest.order.join()),
        `${release.still.length} frames observed, ${new Set(release.still.map((frame) => frame.order.join())).size} distinct orders`);

      check(`[${direction}] no tile is left lifted after the drop`,
        release.rest.tiles.every((tile) => tile.dragging === false) && release.rest.sorting !== 'true',
        `dragging=${release.rest.tiles.filter((tile) => tile.dragging).length}`);
    } finally {
      await harness.close();
    }
  }
}

/**
 * A continuous drag across several slots.
 *
 * Two things are asserted that a single-slot test cannot reach:
 *
 *   - each slot boundary crossed performs exactly one adjacent swap, so the
 *     order changes progressively (three crossings —three writes), and
 *   - the tile does not accumulate drift. The published bug is geometric: on
 *     every swap the tile's *layout* position changes by one slot while its
 *     `translate` keeps the old offset, so the painted tile runs away from the
 *     cursor by one slot per swap and finally leaves the clipped grid
 *     entirely.
 */
async function scenarioMultiSlot() {
  const harness = await startHarness();
  await harness.open({ headed });
  try {
    await installRecorder(harness.page);
    const board = await readBoard(harness.page);
    const tiles = board.rest.tiles;
    const target = tiles[0];
    const slotWidth = tiles[0].width;
    const grid = board.rest.grid;

    const press = await dragThrough(harness.page, {
      label: target.label,
      waypoints: [1, 2, 3].map((index) => ({ x: tiles[index].center.x, y: tiles[index].center.y })),
      steps: 10,
      // Sample *inside* each leg, not just at its end, so a swap that happens
      // and reverses within one leg is still visible in the series.
      chunk: 2,
      holdMs: 90,
    });

    const trace = press.trace;
    const indexSeries = trace.map((row) => row.order.indexOf(target.label));
    /*
     * One slot per crossing, read as a series rather than a fixed list.
     *
     * The sampler steps *inside* each leg, so the series length depends on how
     * many chunks a leg was walked in. What must hold is the shape: the index
     * only ever rises, by exactly one, and reaches the target.
     */
    const steps = indexSeries.slice(1).map((value, index) => value - indexSeries[index]);
    const illegal = steps.filter((step) => step !== 0 && step !== 1);
    check('the tile advances one slot at a time, never skipping or retreating',
      illegal.length === 0 && Math.max(...indexSeries) === 3,
      illegal.length === 0
        ? `slot index over ${indexSeries.length} samples: ${indexSeries.join(' -> ')}`
        : `illegal step(s) ${illegal.join(',')} in ${indexSeries.join(' -> ')}`);
    const orders = trace.map((row) => row.order.join('>'));
    const distinctOrders = new Set(orders);
    // The order must change *mid-gesture*: at least one sample before the last
    // already differs from the starting order. A board that only reorders on
    // `mouseup` has exactly one distinct order here.
    const changedEarly = distinctOrders.size > 1 && orders.slice(0, -1).some((order) => order !== orders[0]);
    check('the painted order changes during the gesture, not once at the end',
      changedEarly,
      `${distinctOrders.size} distinct orders across ${trace.length} samples, first at sample ${orders.findIndex((order) => order !== orders[0])}`);

    // Drift: the painted tile must stay on the pointer for the whole journey.
    const gaps = trace.slice(1).map((row) => pointerGap(row)).filter((gap) => gap !== null);
    const worstGap = gaps.reduce((worst, gap) => Math.max(worst, Math.abs(gap.x)), 0);
    check('the lifted tile tracks the pointer across every swap',
      worstGap <= slotWidth * 0.35,
      `worst pointer-to-tile gap: ${fmt(worstGap)}px, tolerance ${fmt(slotWidth * 0.35)}px`);

    /*
     * Containment: the reader has to be able to see the card they are dragging.
     *
     * The grid is `overflow:hidden`, so anything that leaves its box is
     * literally invisible. The tolerance is the lift's own visual overflow: the
     * tile is scaled to 1.04, which puts ~2% of its width past the edge of its
     * slot when it sits in the last column —cosmetic, and the exact size of the
     * artefact rather than a magic number. The published bug escaped by up to
     * 813px, which is over 100x this tolerance.
     */
    const liftOverflow = tiles[0].width * 0.02 + 2;
    const escaped = trace.filter((row) => row.lifted !== null
      && row.lifted.left + row.lifted.width > row.grid.left + row.grid.width + liftOverflow);
    const worstEscape = trace.reduce((worst, row) => {
      if (row.lifted === null) return worst;
      return Math.max(worst, row.lifted.left + row.lifted.width - (row.grid.left + row.grid.width));
    }, 0);
    check('the lifted tile stays inside the grid, so it is never clipped away',
      escaped.length === 0,
      `worst overflow ${fmt(worstEscape)}px, tolerance ${fmt(liftOverflow)}px (${escaped.length}/${trace.length} samples over)`);

    // Oscillation: while the pointer is still, the board must be still.
    const holdBreaks = press.legTraces.flatMap((leg) => {
      const distinct = new Set(leg.still.map((frame) => frame.order.join()));
      return distinct.size > 1 ? [{ leg: leg.legIndex, distinct: distinct.size }] : [];
    });
    check('the board stops moving while the pointer is held still',
      holdBreaks.length === 0,
      holdBreaks.length === 0
        ? `${press.legTraces.reduce((count, leg) => count + leg.still.length, 0)} still frames, one order`
        : `oscillating at ${JSON.stringify(holdBreaks)}`);

    /*
     * Monotonicity: a pointer that only ever moves right must only ever push
     * the tile right.
     *
     * This is the assertion that catches a swap/stale-measurement loop. The
     * observed defect walks 1 —2 —1 —3 —7: the tile swaps forward, the
     * re-measured slot rectangles are read one frame late, the pointer is then
     * judged to be back over the tile it just left, and it swaps back. The
     * final order can still look plausible, so only the intermediate series
     * exposes it.
     */
    const draggedIndexSeries = trace.map((row) => row.order.indexOf(target.label));
    const backwards = draggedIndexSeries.filter((value, index) => index > 0 && value < draggedIndexSeries[index - 1]);
    check('the tile never moves backwards while the pointer only moves forwards',
      backwards.length === 0,
      backwards.length === 0
        ? `slot index rose monotonically: ${draggedIndexSeries.join(' -> ')}`
        : `went backwards ${backwards.length}x: ${draggedIndexSeries.join(' -> ')}`);

    check('three crossings produced three adjacent swaps',
      press.beforeRelease.order.indexOf(target.label) === 3,
      `final index ${press.beforeRelease.order.indexOf(target.label)}, order: ${press.beforeRelease.order.join(' ')}`);

    const release = await releasePointer(harness.page);
    check('the multi-slot drop keeps the order the gesture built',
      release.rest.order.join() === press.beforeRelease.order.join(),
      release.rest.order.join(' '));

    check('the persisted order matches the painted order',
      release.writes.length > 0 && JSON.stringify(release.writes.at(-1).map((id) => id)) !== JSON.stringify([]),
      `last write: ${JSON.stringify(release.writes.at(-1))}`);

    check('no tile keeps a translate after the drop',
      release.rest.tiles.every((tile) => tile.transform === 'none' || tile.transform === 'matrix(1, 0, 0, 1, 0, 0)'),
      release.rest.tiles.map((tile) => tile.transform).filter((value) => value !== 'none').join(' ') || 'all none');
  } finally {
    await harness.close();
  }
}

/**
 * A drag that changes row as well as column.
 *
 * "Insert" and "swap" look identical when moving one slot sideways; only a
 * cross-row drag reveals the difference. The contract here is the same
 * puzzle-piece rule as everywhere else: the tile trades places with whichever
 * neighbour it is currently crossing, one step at a time. It therefore does
 * *not* teleport from slot 1 to slot 7 in one jump —it walks there, and the
 * cards it walked past keep their relative order.
 *
 * That last part is the real test of swap-vs-insert: an `insert` (splice) leaves
 * the passed cards shifted by one, a `swap` moves each exactly one slot and
 * leaves all the unvisited cards where they were.
 */
async function scenarioVertical() {
  const harness = await startHarness();
  await harness.open({ headed });
  try {
    await installRecorder(harness.page);
    const board = await readBoard(harness.page);
    const tiles = board.rest.tiles;
    const target = tiles[1];
    const destination = tiles[7];

    const press = await dragThrough(harness.page, {
      label: target.label,
      waypoints: [{ x: destination.center.x, y: destination.center.y }],
      steps: 30,
    });
    const during = press.trace.at(-1);

    check('a cross-row drag lands the card in the target slot',
      during.order.indexOf(target.label) === 7,
      `index ${during.order.indexOf(target.label)}, order: ${during.order.join(' ')}`);

    /*
     * Swap semantics, stated as an invariant rather than a count.
     *
     * Under a puzzle-piece swap, every card the dragged tile passed has moved
     * exactly one slot, and every card it never touched is still at its
     * original index. Under an insert, the untouched cards downstream all shift.
     */
    const indexOf = (order, label) => order.indexOf(label);
    const displaced = board.rest.order.filter((label, originalIndex) => {
      if (label === target.label) return false;
      return indexOf(during.order, label) !== originalIndex;
    });
    const passedLabels = new Set(board.rest.order.slice(2, 8));
    const untouched = displaced.filter((label) => !passedLabels.has(label));

    check('a cross-row drag does not shift the cards it never crossed',
      untouched.length === 0,
      untouched.length === 0
        ? 'every unmoved card kept its slot'
        : `unrelated cards shifted: ${untouched.join(', ')}`);

    // No per-card displacement assertion here.
    //
    // The exact exchange rule is covered by test/order.mjs, which runs stepOrder
    // directly against a known board (A onto C pushes B; A onto E trades with E).
    // At this level a real pointer wobbles: a card sitting on the path can be
    // pushed more than once as the finger curves, so "each displaced card moved
    // exactly one neighbour" is not a property of a correct implementation — it
    // is a property of a straight-line drag. Asserting it here would fail a
    // working build and, worse, invite "fixing" the code to satisfy the test.


    const gap = pointerGap(during);
    check('the dragged card stays under the pointer across the row change',
      gap !== null && Math.abs(gap.x) <= tiles[0].width * 0.35 && Math.abs(gap.y) <= tiles[0].height * 0.35,
      gap === null ? 'no lifted tile' : `gap x=${fmt(gap.x)} y=${fmt(gap.y)}, tolerance ${fmt(tiles[0].width * 0.35)}`);

    const release = await releasePointer(harness.page);
    check('the cross-row order survives the drop',
      release.rest.order.indexOf(target.label) === 7,
      release.rest.order.join(' '));
  } finally {
    await harness.close();
  }
}

/**
 * Persistence: what the board writes is what the board reads back.
 *
 * The stored order is a list of card ids; a reload has to reproduce the exact
 * painted arrangement, and a card the stored list has never heard of must
 * still be shown (it would otherwise vanish for anyone upgrading).
 */
async function scenarioPersist() {
  const first = await startHarness();
  let persisted = null;
  let paintedAfterDrag = null;
  try {
    await first.open({ headed });
    await installRecorder(first.page);
    const board = await readBoard(first.page);
    const tiles = board.rest.tiles;
    const target = tiles[0];

    await dragThrough(first.page, {
      label: target.label,
      waypoints: [{ x: tiles[2].center.x, y: tiles[2].center.y }],
      steps: 14,
    });
    const release = await releasePointer(first.page);
    paintedAfterDrag = release.rest.order;
    const writes = release.writes;
    persisted = writes.at(-1) ?? null;

    check('a rearranged board is written to the layout endpoint',
      Array.isArray(persisted) && persisted.length === CARDS,
      `${writes.length} writes, last has ${persisted?.length} ids`);

    check('the persisted order matches the painted order',
      persisted !== null && persisted[0] === 'totalCost' && persisted[1] === 'todayTokens' && persisted[2] === 'totalTokens',
      JSON.stringify(persisted));
  } finally {
    await first.close();
  }

  const second = await startHarness({ layout: { order: persisted } });
  try {
    await second.open({ headed });
    const board = await readBoard(second.page);
    check('reloading with the stored order reproduces the painted board',
      board.rest.order.join() === paintedAfterDrag.join(),
      `${board.rest.order.join(' ')} vs ${paintedAfterDrag.join(' ')}`);

    check('the stored order is read exactly once',
      board.reads === 1,
      `${board.reads} reads`);
  } finally {
    await second.close();
  }

  // A stored order that predates a card must not hide the new card.
  const third = await startHarness({ layout: { order: ['dailyCost', 'cacheShare'] } });
  try {
    await third.open({ headed });
    const board = await readBoard(third.page);
    check('a stored order that omits cards still shows every card',
      board.rest.tiles.length === CARDS,
      `${board.rest.tiles.length} tiles from a 2-id stored order`);
    check('a stored order is honoured as a prefix',
      board.rest.order[0] === '日均花费' && board.rest.order[1] === '缓存命中占比',
      board.rest.order.slice(0, 3).join(' '));
  } finally {
    await third.close();
  }
}

/**
 * A narrow window: the same gesture on the two-column layout.
 *
 * The stored state is only an order, so the contract is that a rearrangement
 * survives a resize. A drag that assumes four columns produces a slot index
 * that means nothing in a two-column grid.
 */
async function scenarioResponsive() {
  const harness = await startHarness();
  try {
    await harness.open({ headed, viewport: { width: 760, height: 900 } });
    await installRecorder(harness.page);
    const board = await readBoard(harness.page);

    check('a narrow window draws two columns',
      new Set(board.rest.tiles.slice(0, 4).map((tile) => Math.round(tile.left))).size === 2,
      board.rest.tiles.slice(0, 4).map((tile) => Math.round(tile.left)).join(','));

    const tiles = board.rest.tiles;
    const target = tiles[0];
    await dragThrough(harness.page, {
      label: target.label,
      waypoints: [{ x: tiles[1].center.x, y: tiles[1].center.y }],
      steps: 12,
    });
    const release = await releasePointer(harness.page);

    check('a swap works in the two-column layout',
      release.rest.order.indexOf(target.label) === 1,
      `index ${release.rest.order.indexOf(target.label)}, order: ${release.rest.order.join(' ')}`);

    check('a two-column drag persists an order',
      release.writes.length === 1,
      `${release.writes.length} writes`);
  } finally {
    await harness.close();
  }
}
//#endregion

//#region runner
const SCENARIOS = {
  idle: scenarioIdle,
  press: scenarioPress,
  track: scenarioTrack,
  swap: scenarioSwap,
  multi: scenarioMultiSlot,
  vertical: scenarioVertical,
  persist: scenarioPersist,
  responsive: scenarioResponsive,
};

const named = only === null ? Object.keys(SCENARIOS) : Object.keys(SCENARIOS).filter((name) => only.has(name));
if (named.length === 0) {
  console.error(`no scenario matched --only=${[...only].join(',')}; known: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(2);
}

console.log('dsh-token-bi · card drag acceptance · real browser');
const started = Date.now();
for (const name of named) {
  group(`[${name}]`);
  try {
    await SCENARIOS[name]();
  } catch (error) {
    check(`${name} scenario completed`, false, error instanceof Error ? error.message.split('\n')[0] : String(error));
  }
}

const failed = results.filter((row) => row.pass === false);
const passed = results.length - failed.length;
console.log(`\n${passed}/${results.length} assertions passed in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (failed.length > 0) {
  console.log('\nfailing assertions');
  for (const row of failed) console.log(`  ${row.group} · ${row.name}\n      ${row.detail}`);
}

if (reportPath !== null) {
  writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    passed,
    failed: failed.length,
    results,
  }, null, 2));
  console.log(`\nreport written to ${reportPath}`);
}

process.exit(failed.length === 0 ? 0 : 1);
//#endregion
