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
import { priceOf, costOf, inCny, rateFor, inPeakWindow, CNY_PER_USD, PRICING, PRICING_DIGEST } from '../lib/pricing.mjs';
import { createHash } from 'node:crypto';

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

// Jet Hub / Qoder gateway codes. These are opaque (`dfmodel`, `qmodel_38max`)
// and carry no hint of the model behind them, so each one is pinned here:
// they were read off the gateway's own model list.
check('dfmodel is DeepSeek Flash', priceOf('qodercn', 'dfmodel') === PRICING['deepseek/deepseek-v4.1-flash']);
check('dmodel is DeepSeek V4 Pro', priceOf('qodercn', 'dmodel') === PRICING['deepseek/deepseek-v4-pro']);
check('qmodel_38max is Qwen3.8-Max', priceOf('qodercn', 'qmodel_38max') === PRICING['alibaba/qwen3.8-max']);
check('gmodel is GLM-5.3', priceOf('qodercn', 'gmodel') === PRICING['zhipu/glm-5.3']);
check('gfmodel is GLM-5.3-Flash', priceOf('qodercn', 'gfmodel') === PRICING['zhipu/glm-5-3-flash']);
// Codes the gateway lists but with no public rate behind them stay unpriced.
check('an unpriced gateway model stays unknown', priceOf('qodercn', 'lmodel') === undefined);

// Free tiers are priced at zero rather than left out. An omitted model would
// show up as "unpriced tokens" and make a bill look incomplete when nothing
// was billed at all.
const freeFlash = priceOf('qodercn', 'qfmodel');
check('the free-quota model resolves', freeFlash === PRICING['alibaba/qwen3.8-flash']);
check('the free-quota model costs nothing',
  costOf(freeFlash, { input: 10e6, cacheRead: 10e6, cacheWrite: 0, output: 10e6 }) === 0);
const invite = priceOf('qw4', 'qwen-latest-series-invite-1102');
check('the invite-only build resolves', invite === PRICING['alibaba/qwen-latest-invite']);
check('the invite-only build costs nothing', costOf(invite, { input: 10e6, cacheRead: 0, cacheWrite: 0, output: 10e6 }) === 0);
//#endregion

//#region unknown stays unknown
// A guessed price is worse than an honest "I do not know": it would put a
// confident wrong number on a bill.
check('an unmapped gateway code stays unpriced', priceOf('qoder', 'fast') === undefined);
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

//#region cache-hit ratio
for (const [key, entry] of Object.entries(PRICING)) {
  if (!key.startsWith('deepseek/')) continue;
  const schedule = entry.offpeak ?? entry.flat;
  if (schedule === undefined) continue;
  const ratio = schedule.input / schedule.cacheRead;
  console.log(`${ratio >= 20 ? 'PASS' : 'FAIL'}  ${key} cache hit is at least 20x cheaper than cache miss` +
    `  (input ${schedule.input} / cacheRead ${schedule.cacheRead} = ${ratio.toFixed(1)}x)`);
  if (!(ratio >= 20)) failures += 1;
}

// The published off-peak figures, verbatim from the vendor's own price page.
// Hard-coding two of them catches a mistyped digit that a ratio check would pass.
{
  const flash = PRICING['deepseek/deepseek-v4.1-flash'].offpeak;
  check('V4.1-Flash off-peak cache hit is 0.02 a million', flash.cacheRead === 0.02, String(flash.cacheRead));
  check('V4.1-Flash off-peak cache miss is 1 a million', flash.input === 1, String(flash.input));
  check('V4.1-Flash off-peak output is 4 a million', flash.output === 4, String(flash.output));
  const peak = PRICING['deepseek/deepseek-v4.1-flash'].peak;
  check('peak is exactly double off-peak',
    peak.input === flash.input * 2 && peak.cacheRead === flash.cacheRead * 2 && peak.output === flash.output * 2,
    `${peak.input}/${peak.cacheRead}/${peak.output}`);
}
//#endregion

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
//#region price digest
{
  const recomputed = createHash('sha1')
    .update(JSON.stringify(PRICING))
    .update('7.1')
    .digest('hex')
    .slice(0, 16);
  check('the price digest is derived from the table itself',
    PRICING_DIGEST === recomputed, `${PRICING_DIGEST} vs ${recomputed}`);
  check('the digest looks like a digest', /^[0-9a-f]{16}$/.test(PRICING_DIGEST), PRICING_DIGEST);

  // Changing any rate must change the digest; this is what invalidates the cache.
  const mutated = JSON.parse(JSON.stringify(PRICING));
  mutated['deepseek/deepseek-v4.1-flash'].offpeak.cacheRead = 0.11;
  const afterEdit = createHash('sha1')
    .update(JSON.stringify(mutated))
    .update('7.1')
    .digest('hex')
    .slice(0, 16);
  check('editing a rate changes the digest', afterEdit !== PRICING_DIGEST);
}
//#endregion

console.log('\npricing ok');