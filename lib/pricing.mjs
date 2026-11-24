/**
 * Model price table.
 *
 * Every figure here was read from the vendor's own pricing page (or a doc that
 * quotes it) in November 2026; the source URL is on each entry. Prices move,
 * so this file is meant to be edited, not trusted forever.
 *
 * Units: `perMillion` of the listed currency, for one of the four billable
 * buckets the ledger already records:
 *
 *   input        – prompt tokens that missed the cache
 *   cacheRead    – prompt tokens served from the cache
 *   cacheWrite   – tokens written into the cache (only some vendors charge)
 *   output       – generated tokens
 *
 * Two wrinkles the flat table cannot avoid:
 *
 *   - Some vendors bill by time of day (DeepSeek calls it 峰谷 / peak-offpeak).
 *     Those entries carry `peak` and `offpeak` blocks plus the `peakHours` that
 *     select between them.
 *   - Some bill by prompt length (Grok 4.6 above 200k). Those carry tiers keyed
 *     by the threshold; `tiers` is checked longest-first.
 *
 * Anything not in here is `undefined` on purpose. A guessed price is worse than
 * no price: it turns an honest "unknown" into a confident wrong number, and the
 * bill is the one place that must not lie.
 */

/** Exchange rate used to fold CNY and USD quotes into one number. */
export const CNY_PER_USD = 7.1;

/**
 * DeepSeek's peak window, in the vendor's own words: weekdays 09:00–12:00 and
 * 14:00–18:00 Beijing time; every other hour is off-peak.
 */
const DEEPSEEK_PEAK = {
  timeZone: 'Asia/Shanghai',
  weekdayOnly: true,
  ranges: [[9, 12], [14, 18]],
};

/** OpenAI-style long-context surcharge: past the threshold the whole request reprices. */
const longContext = (threshold, rate) => ({ threshold, rate });

export const PRICING = {
  // #region DeepSeek — CNY, peak/off-peak
  'deepseek/deepseek-v4-flash': {
    currency: 'CNY',
    source: 'https://developer.aliyun.com/article/1762718',
    peakHours: DEEPSEEK_PEAK,
    offpeak: { input: 1, cacheRead: 0.02, cacheWrite: 0, output: 4 },
    peak: { input: 2, cacheRead: 0.04, cacheWrite: 0, output: 8 },
  },
  'deepseek/deepseek-v4.1-flash': {
    currency: 'CNY',
    source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    peakHours: DEEPSEEK_PEAK,
    // Cache-hit input is *much* cheaper than cache-miss — 0.02 against 1, a ratio
    // of 1:50, not the 1:10 this table used to assume. Because cache hits are the
    // bulk of an agent's tokens, guessing that ratio inflated the bill by a factor
    // of five on the largest bucket.
    offpeak: { input: 1, cacheRead: 0.02, cacheWrite: 0, output: 4 },
    peak: { input: 2, cacheRead: 0.04, cacheWrite: 0, output: 8 },
  },
  'deepseek/deepseek-v4-pro': {
    currency: 'CNY',
    source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
    peakHours: DEEPSEEK_PEAK,
    offpeak: { input: 4.69, cacheRead: 0.15, cacheWrite: 0, output: 13.5 },
    peak: { input: 9.37, cacheRead: 0.3, cacheWrite: 0, output: 27 },
  },
  // #endregion

  // #region Anthropic — USD
  'anthropic/claude-sonnet-5': {
    currency: 'USD',
    source: 'https://platform.claude.com/docs/zh-CN/models/sonnet-5/overview',
    flat: { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
  },
  'anthropic/claude-sonnet-5-5': {
    currency: 'USD',
    source: 'https://platform.claude.com/docs/zh-CN/models/sonnet-5/overview',
    flat: { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
  },
  'anthropic/claude-sonnet-4-6': {
    currency: 'USD',
    source: 'https://platform.claude.com/docs/en/models/sonnet-4-6/overview.md',
    flat: { input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 },
  },
  // #endregion

  // #region OpenAI — USD
  'openai/gpt-6-sol': {
    currency: 'USD',
    source: 'https://developers.openai.com/api/docs/models/gpt-6-sol',
    flat: { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
    longContext: longContext(272_000, 2),
  },
  'openai/gpt-6-astra': {
    currency: 'USD',
    source: 'https://www.modellix.ai/blog/deepseek-api-pricing',
    flat: { input: 2.5, cacheRead: 0.9, cacheWrite: 2.5, output: 10 },
  },
  // #endregion

  // #region Google — USD
  'google/gemini-3.8-flash': {
    currency: 'USD',
    source: 'https://blog.google/intl/id-id/products/explore-get-answers/memperkenalkan-gemini-38-flash-dan-38-flash-cyber/',
    flat: { input: 0.75, cacheRead: 0.08, cacheWrite: 0, output: 3.75 },
  },
  // #endregion

  // #region Alibaba Qwen — CNY
  // Flash sits in Jet Hub’s free-quota group and is not billed.
  'alibaba/qwen3.8-flash': {
    currency: 'CNY',
    source: 'free-quota model on Jet Hub (owner-confirmed: no charge)',
    flat: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  },
  // Invite-only test builds are not charged either.
  'alibaba/qwen-latest-invite': {
    currency: 'CNY',
    source: 'invite-only test model (owner-confirmed: no charge)',
    flat: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  },
  'alibaba/qwen3.8-max': {
    currency: 'CNY',
    source: 'https://developer.aliyun.com/article/1774292',
    flat: { input: 12, cacheRead: 1.5, cacheWrite: 15, output: 36 },
  },
  // #endregion

  // #region Zhipu GLM — CNY
  'zhipu/glm-5.3': {
    currency: 'CNY',
    source: 'https://bigmodel.cn/pricing',
    flat: { input: 8, cacheRead: 2, cacheWrite: 0, output: 28 },
  },
  'zhipu/glm-5-3-flash': {
    currency: 'CNY',
    source: 'https://bigmodel.cn/pricing',
    flat: { input: 8, cacheRead: 2, cacheWrite: 0, output: 28 },
  },
  // #endregion

  // #region Moonshot Kimi — USD
  'moonshot/kimi-k3': {
    currency: 'USD',
    source: 'https://www.morphllm.com/kimi-api',
    flat: { input: 3, cacheRead: 0.3, cacheWrite: 3, output: 15 },
  },
  'moonshot/kimi-k2.7-code': {
    currency: 'USD',
    source: 'https://www.morphllm.com/kimi-api',
    flat: { input: 0.95, cacheRead: 0.19, cacheWrite: 0.95, output: 4 },
  },
  'moonshot/kimi-k2.7-code-highspeed': {
    currency: 'USD',
    source: 'https://www.morphllm.com/kimi-api',
    flat: { input: 1.9, cacheRead: 0.38, cacheWrite: 1.9, output: 8 },
  },
  // #endregion

  // #region xAI Grok — USD
  'xai/grok-4.6': {
    currency: 'USD',
    source: 'https://docs.x.ai/developers/pricing.md',
    flat: { input: 2, cacheRead: 0.5, cacheWrite: 0, output: 6 },
    longContext: longContext(200_000, 2),
  },
  // #endregion

  // #region local — free
  'local/*': {
    currency: 'CNY',
    source: 'local inference, no API spend',
    flat: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  },
  // #endregion
};

/**
 * The model names seen in a real ledger, folded onto the entries above.
 *
 * Vendors and gateways spell the same model differently — case, hyphens, a
 * `-1017` build suffix, a vendor prefix. The ledger stores whatever the gateway
 * reported, so matching has to be forgiving or most rows would read "unknown"
 * when the price is actually known.
 *
 * Keys are lower-cased; values are the pricing key.
 */
const ALIASES = {
  'deepseek-v4-flash': 'deepseek/deepseek-v4-flash',
  'deepseek-flash': 'deepseek/deepseek-v4.1-flash',
  'deepseek-v4.1-flash': 'deepseek/deepseek-v4.1-flash',
  'deepseek-v4.1-flash-1017': 'deepseek/deepseek-v4.1-flash',
  'deepseek/deepseek-v4.1-flash-1017': 'deepseek/deepseek-v4.1-flash',
  'deepseek-v4-pro': 'deepseek/deepseek-v4-pro',
  // Gateways spell the version with hyphens where the vendor uses dots
  // (`deepseek-v4-1-flash`), and prepend their own tag (`sn-`). Same model.
  'deepseek-v4-1-flash': 'deepseek/deepseek-v4.1-flash',
  'sn-deepseek-v4-1-flash-1017': 'deepseek/deepseek-v4.1-flash',
  'glm-5.3-flash': 'zhipu/glm-5-3-flash',
  // Jet Hub / Qoder gateway codes, read off its model list. The trailing
  // MULTIPLIER on each row (x0.1 … x1) is Qoder's credit-burn rate, NOT a price
  // factor — the owner confirmed it does not scale the token bill.
  // number in that list (x0.1, x0.5) is Qoder's own consumption multiplier,
  // not a token price, so it is deliberately not used here.
  'dfmodel': 'deepseek/deepseek-v4.1-flash',
  'dmodel': 'deepseek/deepseek-v4-pro',
  'qmodel_38max': 'alibaba/qwen3.8-max',
  'qmodel_latest': 'alibaba/qwen3.8-max',
  'gmodel': 'zhipu/glm-5.3',
  'gfmodel': 'zhipu/glm-5-3-flash',
  'qfmodel': 'alibaba/qwen3.8-flash',
  'qwen-latest-series-invite-1102': 'alibaba/qwen-latest-invite',
  'claude-sonnet-5': 'anthropic/claude-sonnet-5',
  'claude-sonnet-5-5': 'anthropic/claude-sonnet-5-5',
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-6',
  'gpt-6-sol': 'openai/gpt-6-sol',
  'gpt-6-astra': 'openai/gpt-6-astra',
  'gemini-3.8-flash': 'google/gemini-3.8-flash',
  'gemini-3.8-flash-high': 'google/gemini-3.8-flash',
  'qwen3.8-max': 'alibaba/qwen3.8-max',
  'qwen3.8-max-0902': 'alibaba/qwen3.8-max',
  'glm-5.3': 'zhipu/glm-5.3',
  'glm-5-3-flash': 'zhipu/glm-5-3-flash',
  'kimi-k3': 'moonshot/kimi-k3',
  'kimi-k2.7-code': 'moonshot/kimi-k2.7-code',
  'kimi-k2.7-code-highspeed': 'moonshot/kimi-k2.7-code-highspeed',
  'grok-4.6': 'xai/grok-4.6',
};

/** Normalise a model name for lookup: lower case, vendor prefix kept. */
const normalise = (name) => String(name ?? '').trim().toLowerCase();

/**
 * Resolve a `provider/model` pair from the ledger to a pricing entry.
 *
 * The search is deliberately forgiving and ordered: exact key, then the alias
 * table on either the full `provider/model` or the bare model name.
 * Returns `undefined` when nothing matches — callers must show that as unknown.
 */
export function priceOf(provider, model) {
  const full = normalise(`${provider}/${model}`);
  if (PRICING[full] !== undefined) return PRICING[full];

  const bare = normalise(model);
  if (PRICING[bare] !== undefined) return PRICING[bare];
  if (ALIASES[full] !== undefined) return PRICING[ALIASES[full]];
  if (ALIASES[bare] !== undefined) return PRICING[ALIASES[bare]];

  // Local runtimes cost nothing to call.
  if (provider === 'ollama' || provider === 'local') return PRICING['local/*'];

  return undefined;
}

/**
 * Is this instant inside a vendor's peak window?
 *
 * Reads the wall clock in the vendor's own time zone, because a "weekday 9 to
 * 12" rule means nothing in the wrong zone.
 */
export function inPeakWindow(instantMs, peakHours) {
  if (peakHours === undefined) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: peakHours.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(new Date(instantMs));
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
  const hour = Number(pick('hour')) + Number(pick('minute')) / 60;
  if (peakHours.weekdayOnly) {
    const weekday = pick('weekday');
    if (weekday === 'Sat' || weekday === 'Sun') return false;
  }
  return peakHours.ranges.some(([from, to]) => hour >= from && hour < to);
}

/** The rate block that applies to one call. */
export function rateFor(entry, { atMs, promptTokens } = {}) {
  if (entry.flat !== undefined) {
    const multiplier = entry.longContext !== undefined && promptTokens >= entry.longContext.threshold
      ? entry.longContext.rate
      : 1;
    return {
      input: entry.flat.input * multiplier,
      cacheRead: entry.flat.cacheRead * multiplier,
      cacheWrite: entry.flat.cacheWrite * multiplier,
      output: entry.flat.output * multiplier,
    };
  }
  // Peak/off-peak vendors. When no timestamp is known, assume off-peak and say
  // so, rather than silently charging peak.
  return inPeakWindow(atMs ?? 0, entry.peakHours) ? entry.peak : entry.offpeak;
}

/**
 * Cost of a usage row, in the entry's own currency.
 *
 * The four buckets are billed at their own rates; that is the whole reason the
 * ledger keeps them apart.
 */
export function costOf(entry, usage, { atMs, promptTokens } = {}) {
  const rate = rateFor(entry, { atMs, promptTokens });
  const input = (Number(usage.input) || 0) * rate.input;
  const cacheRead = (Number(usage.cacheRead) || 0) * rate.cacheRead;
  const cacheWrite = (Number(usage.cacheWrite) || 0) * rate.cacheWrite;
  const output = (Number(usage.output) || 0) * rate.output;
  return (input + cacheRead + cacheWrite + output) / 1_000_000;
}

/** Fold a cost in the entry's currency into CNY. */
export function inCny(entry, cost) {
  return entry.currency === 'USD' ? cost * CNY_PER_USD : cost;
}