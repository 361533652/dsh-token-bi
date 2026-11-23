/**
 * The reorder rules, tested as functions.
 *
 * These three helpers decide every swap the card grid makes, and they are pure,
 * so they can be checked exactly instead of by inspecting source text. The
 * pointer behaviour that drives them is covered separately in test/drag.mjs.
 *
 *   node test/order.mjs
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/**
 * Pull a top-level function out of the client bundle.
 *
 * The bundle is a browser module wrapped in a loader call, so it cannot simply be
 * imported. Evaluating the one function in isolation keeps the test honest: it
 * runs the shipped code, not a copy.
 */
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  // Walk to the matching closing brace of the function body.
  let depth = 0;
  let index = source.indexOf('{', start);
  const from = index;
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  // eslint-disable-next-line no-new-func
  return new Function(`return (${source.slice(start, index + 1)})`)();
}

const mergeOrder = extract('mergeOrder');
const stepOrder = extract('stepOrder');
const slotIndexAt = extract('slotIndexAt');

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

//#region stepOrder
// The owner's rule, on a four-column board:
//     A B C D
//     E F G H
// Dragging A onto C pushes B aside (they are in the same row, B is in between).
// Dragging A onto E is a single trade, because E is the tile directly below —
// "adjacent" means adjacent on the board, not adjacent in a flattened list.
const board = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const COLS = 4;

check('A onto C pushes the one tile between them',
  JSON.stringify(stepOrder(board, 'A', 2, COLS)) === JSON.stringify(['B', 'C', 'A', 'D', 'E', 'F', 'G', 'H']),
  JSON.stringify(stepOrder(board, 'A', 2, COLS)));

check('A onto E is a single trade with the tile below',
  JSON.stringify(stepOrder(board, 'A', 4, COLS)) === JSON.stringify(['E', 'B', 'C', 'D', 'A', 'F', 'G', 'H']),
  JSON.stringify(stepOrder(board, 'A', 4, COLS)));

// One horizontal step is still a plain trade.
check('one step right trades neighbours',
  JSON.stringify(stepOrder(board, 'A', 1, COLS)) === JSON.stringify(['B', 'A', 'C', 'D', 'E', 'F', 'G', 'H']));
check('one step left trades neighbours',
  JSON.stringify(stepOrder(board, 'B', 0, COLS)) === JSON.stringify(['B', 'A', 'C', 'D', 'E', 'F', 'G', 'H']));

// E up onto A: the same trade seen from the other end.
check('E onto A is also a single trade',
  JSON.stringify(stepOrder(board, 'E', 0, COLS)) === JSON.stringify(['E', 'B', 'C', 'D', 'A', 'F', 'G', 'H']),
  JSON.stringify(stepOrder(board, 'E', 0, COLS)));

// A diagonal drag walks like a staircase: A onto F is down then across, or across
// then down, but each hop is a single grid neighbour.
const diagonal = stepOrder(board, 'A', 5, COLS);
check('a diagonal move lands the card in the target slot',
  diagonal[5] === 'A' && diagonal.length === 8, JSON.stringify(diagonal));

// On a taller board, A onto I is two rows straight down: it passes through E.
const tall = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const twoRows = stepOrder(tall, 'A', 8, COLS);
check('A onto I steps down through E',
  JSON.stringify(twoRows) === JSON.stringify(['E', 'B', 'C', 'D', 'I', 'F', 'G', 'H', 'A', 'J', 'K', 'L']),
  JSON.stringify(twoRows));

// The column count comes from the layout, so a two-column board behaves too.
const twoCol = ['A', 'B', 'C', 'D'];
check('on a two-column board the tile below is one step away',
  JSON.stringify(stepOrder(twoCol, 'A', 2, 2)) === JSON.stringify(['C', 'B', 'A', 'D']),
  JSON.stringify(stepOrder(twoCol, 'A', 2, 2)));

// Out-of-range and unknown input must be inert, not throw.
check('a target beyond the end is ignored',
  JSON.stringify(stepOrder(board, 'A', 99, COLS)) === JSON.stringify(board));
check('a negative target is ignored',
  JSON.stringify(stepOrder(board, 'A', -1, COLS)) === JSON.stringify(board));
check('an unknown id is ignored',
  JSON.stringify(stepOrder(board, 'ZZ', 2, COLS)) === JSON.stringify(board));
check('moving to where it already is changes nothing',
  JSON.stringify(stepOrder(board, 'C', 2, COLS)) === JSON.stringify(board));
// The input array must not be mutated: the caller holds the previous order.
const frozen = ['A', 'B', 'C'];
stepOrder(frozen, 'A', 2, 3);
check('the input order is not mutated', JSON.stringify(frozen) === JSON.stringify(['A', 'B', 'C']));
//#endregion


//#region mergeOrder
const ids = ['one', 'two', 'three', 'four'];
check('no stored order keeps declaration order',
  JSON.stringify(mergeOrder(ids, undefined)) === JSON.stringify(ids));
check('an empty stored order keeps declaration order',
  JSON.stringify(mergeOrder(ids, [])) === JSON.stringify(ids));
check('a stored order is honoured',
  JSON.stringify(mergeOrder(ids, ['four', 'two', 'one', 'three'])) === JSON.stringify(['four', 'two', 'one', 'three']));
// A card added in a later build must still show up, after the stored ones.
check('an unmentioned card is appended',
  JSON.stringify(mergeOrder(ids, ['three', 'one'])) === JSON.stringify(['three', 'one', 'two', 'four']));
// An id from a removed card must not create a phantom tile.
check('an unknown stored id is dropped',
  JSON.stringify(mergeOrder(ids, ['gone', 'three'])) === JSON.stringify(['three', 'one', 'two', 'four']));
check('duplicate stored ids collapse',
  mergeOrder(ids, ['two', 'two', 'one']).length === 4);
//#endregion

//#region slotIndexAt
// A 4×2 grid of 100×50 slots at the origin.
const slots = [];
for (let row = 0; row < 2; row += 1) {
  for (let col = 0; col < 4; col += 1) {
    slots.push({ left: col * 100, top: row * 50, width: 100, height: 50 });
  }
}
check('a point picks its own slot', slotIndexAt(slots, 50, 25) === 0);
check('the second slot', slotIndexAt(slots, 150, 25) === 1);
check('the fifth slot is the first of row two', slotIndexAt(slots, 50, 75) === 4);
// The 1px gap between slots must not be a dead zone: every point still names one.
check('a point in the gap still names a slot', slotIndexAt(slots, 100, 25) >= 0);
check('a point past the last slot still names the nearest', slotIndexAt(slots, 9999, 9999) === 7);
check('a point before the first slot names the first', slotIndexAt(slots, -50, -50) === 0);
check('an empty grid names nothing', slotIndexAt([], 10, 10) === -1);
//#endregion

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\norder helpers ok');