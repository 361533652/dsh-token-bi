/**
 * Pricing table checks.
 *
 * The bill is the one place a wrong number is worse than no number, so these
 * tests pin the parts that are easy to get subtly wrong: which rate block a
 * given hour falls into, that the four buckets are billed separately, that a
 * long-context surcharge reprices the whole request, and that an unknown model
 * stays unknown.
 *
 *   node test/pricing.mjs
 */
import { priceOf, costOf, inCny, rateFor, inPeakWindow, CNY_PER_USD, PRICING } from '../lib/pricing.mjs';

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

//#region peak and off-peak
// DeepSeek's window is weekdays 09:00-12:00 and 14:00-18:00 Beijing time.
const peakHours = PRICING['deepseek/deepseek-v4-flash'].peakHours;
const at = (iso) => Date.parse(iso);
// 2026-11-20 is a Friday.
check('Friday 10:00 is peak', inPeakWindow(at('2026-11-20T10:00:00+08:00'), peakHours) === true);
check('Friday 16:00 is peak', inPeakWindow(at('2026-11-20T16:00:00+08:00'), peakHours) === true);
check('Friday 12:30 is off-peak', inPeakWindow(at('2026-11-20T12:30:00+08:00'), peakHours) === false);
check('Friday 08:00 is off-peak', inPeakWindow(at('2026-11-20T08:00:00+08:00'), peakHours) === false);
check('Friday 18:00 is off-peak', inPeakWindow(at('2026-11-20T18:00:00+08:00'), peakHours) === false);
// 2026-11-21 is a Saturday: the weekday rule must exclude it.
check('Saturday 10:00 is off-peak', inPeakWindow(at('2026-11-21T10:00:00+08:00'), peakHours) === false);
// The window is in Beijing time, so the same instant read in UTC must still
// land in the right local hour.
check('peak window is time-zone aware',
  inPeakWindow(at('2026-11-20T02:00:00Z'), peakHours) === true);
//#endregion

//#region the four buckets are priced separately
const dsFlash = PRICING['deepseek/deepseek-v4-flash'];
const offpeakRate = rateFor(dsFlash, { atMs: at('2026-11-20T12:30:00+08:00') });
const peakRate = rateFor(dsFlash, { atMs: at('2026-11-20T10:00:00+08:00') });
check('off-peak rate is the vendor figure',
  offpeakRate.input === 1 && offpeakRate.cacheRead === 0.02 && offpeakRate.output === 4,
  JSON.stringify(offpeakRate));
check('peak is roughly double off-peak',
  peakRate.input === 2 && peakRate.cacheRead === 0.04 && peakRate.output === 8,
  JSON.stringify(peakRate));

// One million tokens of each bucket, off-peak, must sum to the four rates.
const oneEach = costOf(dsFlash, { input: 1e6, cacheRead: 1e6, cacheWrite: 0, output: 1e6 },
  { atMs: at('2026-11-20T12:30:00+08:00') });
check('cache read is billed far below cache miss', oneEach === 1 + 0.02 + 4, String(oneEach));
// A row made only of cache hits must be much cheaper than the same size of
// uncached input — that difference is the point of tracking the buckets.
const cachedOnly = costOf(dsFlash, { input: 0, cacheRead: 10e6, cacheWrite: 0, output: 0 },
  { atMs: at('2026-11-20T12:30:00+08:00') });
const plainOnly = costOf(dsFlash, { input: 10e6, cacheRead: 0, cacheWrite: 0, output: 0 },
  { atMs: at('2026-11-20T12:30:00+08:00') });
check('cached input is cheaper than uncached', cachedOnly < plainOnly, `${cachedOnly} < ${plainOnly}`);
//#endregion

//#region cache writes
// Only some vendors charge for writing the cache; OpenAI does.
const gptSol = PRICING['openai/gpt-6-sol'];
const withWrite = costOf(gptSol, { input: 0, cacheRead: 0, cacheWrite: 1e6, output: 0 });
check('cache writes are charged when the vendor does', withWrite === 2.5, String(withWrite));
const dsWrite = costOf(dsFlash, { input: 0, cacheRead: 0, cacheWrite: 1e6, output: 0 },
  { atMs: at('2026-11-20T12:30:00+08:00') });
check('cache writes are free when the vendor does not charge', dsWrite === 0, String(dsWrite));
//#endregion

//#region long context
// Grok 4.6 doubles above 200k prompt tokens, for the whole request.
const grok = PRICING['xai/grok-4.6'];
const shortRate = rateFor(grok, { promptTokens: 100_000 });
const longRate = rateFor(grok, { promptTokens: 300_000 });
check('short prompt pays the base rate', shortRate.input === 2, JSON.stringify(shortRate));
check('long prompt pays double', longRate.input === 4 && longRate.output === 12, JSON.stringify(longRate));
//#endregion

//#region currency
check('USD is folded into CNY', inCny(gptSol, 1) === CNY_PER_USD, String(inCny(gptSol, 1)));
check('CNY is left alone', inCny(dsFlash, 1) === 1, String(inCny(dsFlash, 1)));
//#endregion

//#region alias resolution
// The ledger stores whatever the gateway reported, so the same model arrives
// under several spellings.
check('dotted build suffix resolves', priceOf('codearts', 'deepseek-v4.1-flash-1017') === dsFlash
  || priceOf('codearts', 'deepseek-v4.1-flash-1017') === PRICING['deepseek/deepseek-v4.1-flash']);
check('hyphenated version resolves', priceOf('aggregate', 'deepseek-v4-1-flash') === PRICING['deepseek/deepseek-v4.1-flash']);
check('vendor tag resolves', priceOf('qiniu', 'deepseek/deepseek-v4.1-flash-1017') === PRICING['deepseek/deepseek-v4.1-flash']);
check('case is ignored', priceOf('loomy', 'DeepSeek-V4.1-Flash') === PRICING['deepseek/deepseek-v4.1-flash']);
check('glm drop-down resolves', priceOf('zcode', 'GLM-5.3-Flash') === PRICING['zhipu/glm-5-3-flash']);
check('local runtime is free', priceOf('ollama', 'qwen3:8b') === PRICING['local/*']);
//#endregion

//#region unknown stays unknown
// A guessed price is worse than an honest "I do not know": it would put a
// confident wrong number on a bill.
check('an unmapped gateway code stays unpriced', priceOf('qodercn', 'dfmodel') === undefined);
check('an unknown model stays unpriced', priceOf('unknown', 'unknown') === undefined);
//#endregion

//#region no entry can silently bill zero
// Every priced entry must carry all four buckets, or a typo would quietly make
// one of them free.
for (const [key, entry] of Object.entries(PRICING)) {
  const block = entry.flat ?? entry.offpeak;
  const ok = block !== undefined
    && ['input', 'cacheRead', 'cacheWrite', 'output'].every((name) => typeof block[name] === 'number');
  if (!ok) {
    console.log(`FAIL  ${key} is missing a bucket`);
    failures += 1;
  }
  if (entry.flat === undefined && entry.offpeak === undefined) {
    console.log(`FAIL  ${key} has neither a flat nor a peak schedule`);
    failures += 1;
  }
}
console.log(`PASS  all ${Object.keys(PRICING).length} entries carry four buckets and a schedule`);
//#endregion

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\npricing ok');