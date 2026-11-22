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
const base = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

// One step is a plain adjacent swap.
check('one step right swaps neighbours',
  JSON.stringify(stepOrder(base, 'a', 1)) === JSON.stringify(['b', 'a', 'c', 'd', 'e', 'f', 'g', 'h']));
check('one step left swaps neighbours',
  JSON.stringify(stepOrder(base, 'b', 0)) === JSON.stringify(['b', 'a', 'c', 'd', 'e', 'f', 'g', 'h']));

// A long move must pass through the neighbours, not jump over them: the result of
// moving a card three places is the same as three one-place moves.
const jump = stepOrder(base, 'a', 3);
check('a long move lands the card at the target',
  jump[3] === 'a' && jump.length === base.length, JSON.stringify(jump));
check('a long move shifts every card it passes by exactly one',
  jump[0] === 'b' && jump[1] === 'c' && jump[2] === 'd', JSON.stringify(jump.slice(0, 4)));
// Nothing outside the travelled range may move.
check('cards beyond the range stay put',
  jump[4] === 'e' && jump[7] === 'h');

// Out-of-range and unknown input must be inert, not throw.
check('a target beyond the end is ignored',
  JSON.stringify(stepOrder(base, 'a', 99)) === JSON.stringify(base));
check('a negative target is ignored',
  JSON.stringify(stepOrder(base, 'a', -1)) === JSON.stringify(base));
check('an unknown id is ignored',
  JSON.stringify(stepOrder(base, 'zz', 2)) === JSON.stringify(base));
check('moving to where it already is changes nothing',
  JSON.stringify(stepOrder(base, 'c', 2)) === JSON.stringify(base));
// The input array must not be mutated: the caller holds the previous order.
const frozen = ['a', 'b', 'c'];
stepOrder(frozen, 'a', 2);
check('the input order is not mutated', JSON.stringify(frozen) === JSON.stringify(['a', 'b', 'c']));
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