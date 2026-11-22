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
// The owner's rule, verbatim: with A B C D, dragging A onto C gives B C A D —
// A takes C's slot, and B and C each slide back into the hole behind it.
const base = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

check('A dragged onto C pushes the row',
  JSON.stringify(stepOrder(base, 'A', 2)) === JSON.stringify(['B', 'C', 'A', 'D', 'E', 'F', 'G', 'H']),
  JSON.stringify(stepOrder(base, 'A', 2)));
check('one step right is a plain swap',
  JSON.stringify(stepOrder(base, 'A', 1)) === JSON.stringify(['B', 'A', 'C', 'D', 'E', 'F', 'G', 'H']));
check('one step left is a plain swap',
  JSON.stringify(stepOrder(base, 'B', 0)) === JSON.stringify(['B', 'A', 'C', 'D', 'E', 'F', 'G', 'H']));
// Dragging backwards pushes the other way: H onto E gives E F G H at the end.
check('dragging backwards pulls the row forward',
  JSON.stringify(stepOrder(base, 'H', 4)) === JSON.stringify(['A', 'B', 'C', 'D', 'H', 'E', 'F', 'G']),
  JSON.stringify(stepOrder(base, 'H', 4)));
// A vertical move in a four-column grid: slot 0 to slot 4 is one row down.
check('a move into the next row lands in that slot',
  JSON.stringify(stepOrder(base, 'A', 4)) === JSON.stringify(['B', 'C', 'D', 'E', 'A', 'F', 'G', 'H']),
  JSON.stringify(stepOrder(base, 'A', 4)));
// Continuing the same drag: after landing in slot 4, moving on to slot 5 pushes
// the card that was there. Successive steps compose, which is what makes a long
// drag a series of pushes rather than one jump.
const afterFirst = stepOrder(base, 'A', 4);
check('a second push in the same drag composes',
  JSON.stringify(stepOrder(afterFirst, 'A', 5)) === JSON.stringify(['B', 'C', 'D', 'E', 'F', 'A', 'G', 'H']),
  JSON.stringify(stepOrder(afterFirst, 'A', 5)));
// Nothing outside the travelled range may move.
const jumped = stepOrder(base, 'A', 3);
check('cards beyond the range stay put',
  jumped[0] === 'B' && jumped[1] === 'C' && jumped[2] === 'D' && jumped[3] === 'A'
  && jumped[4] === 'E' && jumped[7] === 'H', JSON.stringify(jumped));

// Out-of-range and unknown input must be inert, not throw.
check('a target beyond the end is ignored',
  JSON.stringify(stepOrder(base, 'A', 99)) === JSON.stringify(base));
check('a negative target is ignored',
  JSON.stringify(stepOrder(base, 'A', -1)) === JSON.stringify(base));
check('an unknown id is ignored',
  JSON.stringify(stepOrder(base, 'ZZ', 2)) === JSON.stringify(base));
check('moving to where it already is changes nothing',
  JSON.stringify(stepOrder(base, 'C', 2)) === JSON.stringify(base));
// The input array must not be mutated: the caller holds the previous order.
const frozen = ['A', 'B', 'C'];
stepOrder(frozen, 'A', 2);
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