/**
 * Delta labels: how a change between two rendered figures is announced.
 *
 *   node test/delta.mjs
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/** Pull one top-level function's source out of the bundle. */
function slice(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found`);
  let depth = 0;
  let index = source.indexOf('{', start);
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, index + 1);
}

// Evaluated together: figureDelta calls parseFigure, so slicing them separately
// would leave the inner reference dangling. This still runs the shipped code,
// not a copy of it.
// eslint-disable-next-line no-new-func
const { figureDelta, parseFigure } = new Function(
  `${slice('parseFigure')}\n${slice('figureDelta')}\nreturn { figureDelta, parseFigure };`,
)();

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

//#region parseFigure
check('a compacted token count', parseFigure('12.4B')?.value === 12.4e9, String(parseFigure('12.4B')?.value));
check('a millions suffix', parseFigure('182.6M')?.value === 182.6e6);
check('plain digits with separators', parseFigure('1,958')?.value === 1958);
check('money keeps its unit', parseFigure('¥5,079.00')?.money === true);
check('a percentage is flagged', parseFigure('76.4%')?.percent === true);
check('text with no number is null', parseFigure('无消耗') === null);
check('empty text is null', parseFigure('') === null);
//#endregion

//#region figureDelta
const token = figureDelta('12.4B', '12.5B');
check('a token rise reads in the same unit', token?.text === '+0.1B', token?.text);
check('a token rise points up', token?.dir === 'up');

const fall = figureDelta('12.5B', '12.4B');
check('a token fall points down', fall?.dir === 'down', fall?.dir);
check('a token fall is negative', fall?.text === '-0.1B', fall?.text);

// A rise from a small figure to a large one is expressed in the *new* figure's
// unit: 1.2B minus 182.6M is 1.0174B, shown as +1.02B.
const jump = figureDelta('182.6M', '1.2B');
check('a big jump uses the new figure\'s unit', jump?.text === '+1.02B', jump?.text);

const money = figureDelta('¥5,079.00', '¥5,084.00');
check('money keeps the currency symbol', money?.text === '+¥5.00', money?.text);
const moneyBig = figureDelta('¥4,000', '¥5,080');
check('large money is rounded and grouped', moneyBig?.text === '+¥1,080', moneyBig?.text);

const percents = figureDelta('76.0%', '76.4%');
check('a percentage reads in percentage points', percents?.text === '+0.4pp', percents?.text);

// No change must say nothing: a capsule with +0 would be noise.
check('an unchanged figure produces no delta', figureDelta('12.4B', '12.4B') === null);
// Unparseable text must also stay silent rather than inventing a number.
check('unparseable text produces no delta', figureDelta('无消耗', '—') === null);
check('a text change to a number is not a numeric delta', figureDelta('—', '12.4B') === null);
//#endregion

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ndelta ok');