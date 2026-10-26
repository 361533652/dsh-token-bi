/**
 * Pure token-usage accounting for one session event log.
 *
 * The numbers mirror the Host's `tokenUsage` projection (dsh-token-meter):
 * every durable assistant settlement contributes its provider-reported usage,
 * and a later sample for the same (turn, step) replaces the earlier one, so a
 * retried attempt inside one step is counted once.
 *
 * Nothing here touches the filesystem or Cordis; the caller supplies decoded
 * events.
 */

/** Provider usage of one durable settlement, or undefined when it reports none. */
function usageOf(event) {
  if (event.type === 'assistant/message') {
    if (event.data?.usage !== undefined) return event.data.usage;
    return streamUsage(event.data?.stream);
  }
  if (event.type === 'assistant/attempt') return streamUsage(event.data?.stream);
  return undefined;
}

function streamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const entry = stream[index];
    if (entry?.chunk?.type === 'usage' && entry.chunk.usage !== undefined) return entry.chunk.usage;
  }
  return undefined;
}

function count(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function bucketsOf(usage) {
  return {
    input: count(usage.inputTokens),
    output: count(usage.outputTokens),
    cacheRead: count(usage.cacheReadTokens),
    cacheWrite: count(usage.cacheWriteTokens),
  };
}

function routeOf(event) {
  const source = event.data?.message?.source;
  if (source === undefined || source === null) return undefined;
  if (typeof source.provider !== 'string' || typeof source.model !== 'string') return undefined;
  if (source.provider.length === 0 || source.model.length === 0) return undefined;
  return { provider: source.provider, model: source.model };
}

function total(buckets) {
  return buckets.input + buckets.output + buckets.cacheRead + buckets.cacheWrite;
}

const zero = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

function add(target, delta) {
  target.input += delta.input;
  target.output += delta.output;
  target.cacheRead += delta.cacheRead;
  target.cacheWrite += delta.cacheWrite;
}

function subtract(target, delta) {
  target.input -= delta.input;
  target.output -= delta.output;
  target.cacheRead -= delta.cacheRead;
  target.cacheWrite -= delta.cacheWrite;
}

/** `YYYY-MM-DD` in the viewer's local zone. */
export function localDay(time, timeZoneOffsetMinutes = -new Date(time).getTimezoneOffset()) {
  const shifted = time + timeZoneOffsetMinutes * 60_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

/**
 * Fold one log into usage rows plus session-level counters.
 *
 * @param events decoded session events in seq order.
 * @param options.offsetMinutes viewer's UTC offset in minutes (defaults to the host zone).
 * @returns {{
 *   rows: Array<object>, totals: object, models: object, days: object,
 *   turns: number, steps: number, firstTime: number|undefined, lastTime: number|undefined,
 *   llmMs: number, toolMs: number,
 * }}
 */
export function foldUsage(events, options = {}) {
  const offset = options.offsetMinutes ?? -new Date().getTimezoneOffset();
  const rows = [];
  const slots = new Map();
  const totals = zero();
  const models = new Map();
  const days = new Map();
  const turnStarts = new Map();
  const turnEnds = new Map();
  const toolCalls = new Map();
  let steps = 0;
  let llmMs = 0;
  let toolMs = 0;
  let firstTime;
  let lastTime;
  let currentTurn = 1;
  let currentStep = 1;

  const bucketFor = (key) => {
    let bucket = models.get(key);
    if (bucket === undefined) {
      bucket = zero();
      models.set(key, bucket);
    }
    return bucket;
  };

  for (const event of events) {
    const time = typeof event.time === 'number' ? event.time : undefined;
    if (time !== undefined) {
      if (firstTime === undefined || time < firstTime) firstTime = time;
      if (lastTime === undefined || time > lastTime) lastTime = time;
    }
    if (event.data?.turn !== undefined) currentTurn = event.data.turn;
    if (event.data?.step !== undefined) currentStep = event.data.step;

    switch (event.type) {
      case 'turn/start': {
        const turn = event.data?.turn;
        if (typeof turn === 'number') {
          currentTurn = turn;
          if (time !== undefined) turnStarts.set(turn, time);
        }
        break;
      }
      case 'turn/end': {
        const turn = event.data?.turn;
        if (typeof turn === 'number' && time !== undefined) turnEnds.set(turn, time);
        break;
      }
      case 'step/end':
        steps += 1;
        break;
      case 'tool/call': {
        const callId = event.data?.callId;
        if (typeof callId === 'string' && time !== undefined) toolCalls.set(callId, time);
        // Official tool calls are billed per request, not per token. Both of the
        // ones DSH charges for are recorded here so the bill can be reconciled:
        //   web_search -> deepseek-official/tool-search
        //   web_fetch  -> deepseek-official/tool-fetch
        // Every other tool name is local and costs nothing, so it is ignored.
        const toolName = event.data?.name;
        const billedAs = toolName === 'web_search'
          ? { model: 'tool-search', kind: 'search' }
          : toolName === 'web_fetch'
            ? { model: 'tool-fetch', kind: 'fetch' }
            : undefined;
        if (billedAs !== undefined) {
          let detail = '';
          let queryCount = 0;
          try {
            const raw = event.data?.arguments;
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (toolName === 'web_search') {
              const queries = Array.isArray(parsed?.queries)
                ? parsed.queries
                : typeof parsed?.query === 'string' ? [parsed.query] : [];
              queryCount = queries.length;
              detail = queries.join(' | ');
            } else {
              const url = typeof parsed?.url === 'string' ? parsed.url : '';
              detail = url;
            }
          } catch {
            // A malformed argument blob still counts as one call.
          }
          // Billing counts requests, not query terms: one web_search carrying
          // four queries is a single billed request. `queryCount` is kept only
          // for the tooltip, so it never inflates the call count.
          const calls = 1;
          const stamp = time ?? firstTime ?? 0;
          const day = localDay(stamp, offset);
          const provider = 'deepseek-official';
          const model = billedAs.model;
          const routeKey = `${provider}\u0000${model}`;
          const buckets = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

          add(totals, buckets);
          add(bucketFor(routeKey), buckets);
          let dayBucket = days.get(day);
          if (dayBucket === undefined) {
            dayBucket = zero();
            days.set(day, dayBucket);
          }
          add(dayBucket, buckets);

          rows.push({
            turn: currentTurn,
            step: currentStep,
            time: stamp,
            day,
            provider,
            model,
            kind: billedAs.kind,
            note: detail || toolName,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
            apiCalls: calls,
            ...(queryCount > 1 ? { queries: queryCount } : {}),
          });
        }
        break;
      }
      case 'tool/result': {
        const callId = event.data?.message?.toolCallId;
        const started = typeof callId === 'string' ? toolCalls.get(callId) : undefined;
        if (started !== undefined && time !== undefined && time >= started) toolMs += time - started;
        if (typeof callId === 'string') toolCalls.delete(callId);
        break;
      }
      case 'assistant/message':
      case 'assistant/attempt': {
        const usage = usageOf(event);
        if (usage === undefined) break;
        const turn = event.data?.turn;
        const step = event.data?.step;
        if (typeof turn !== 'number' || typeof step !== 'number') break;
        const buckets = bucketsOf(usage);
        const key = `${turn}:${step}`;
        const previous = slots.get(key);
        const route = routeOf(event);
        const provider = route?.provider ?? previous?.provider ?? 'unknown';
        const model = route?.model ?? previous?.model ?? 'unknown';
        const routeKey = `${provider}\u0000${model}`;
        const stamp = time ?? previous?.time ?? firstTime ?? 0;
        const day = localDay(stamp, offset);

        if (previous !== undefined) {
          subtract(totals, previous.buckets);
          subtract(bucketFor(previous.routeKey), previous.buckets);
          const previousDay = days.get(previous.day);
          if (previousDay !== undefined) subtract(previousDay, previous.buckets);
          const row = rows[previous.index];
          row.input -= previous.buckets.input;
          row.output -= previous.buckets.output;
          row.cacheRead -= previous.buckets.cacheRead;
          row.cacheWrite -= previous.buckets.cacheWrite;
        }

        add(totals, buckets);
        add(bucketFor(routeKey), buckets);
        let dayBucket = days.get(day);
        if (dayBucket === undefined) {
          dayBucket = zero();
          days.set(day, dayBucket);
        }
        add(dayBucket, buckets);

        const index = previous?.index ?? rows.length;
        if (previous === undefined) {
          rows.push({
            turn,
            step,
            time: stamp,
            day,
            provider,
            model,
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          });
        }
        const row = rows[index];
        row.time = stamp;
        row.day = day;
        row.provider = provider;
        row.model = model;
        row.input += buckets.input;
        row.output += buckets.output;
        row.cacheRead += buckets.cacheRead;
        row.cacheWrite += buckets.cacheWrite;
        slots.set(key, { index, buckets, provider, model, routeKey, day, time: stamp });
        if (previous === undefined) {
          const turnStart = turnStarts.get(turn);
          if (turnStart !== undefined) llmMs += Math.max(0, stamp - turnStart);
        }
        break;
      }
      case 'compaction/summary': {
        // Compacting a long context is its own model call, and its usage does not
        // appear on any assistant message (verified against the store: no
        // assistant event carries the same numbers). Without this the tokens
        // spent summarising are invisible.
        const usage = event.data?.usage;
        if (usage === undefined || typeof usage !== 'object') break;
        const buckets = bucketsOf(usage);
        const stamp = time ?? firstTime ?? 0;
        const day = localDay(stamp, offset);
        const provider = typeof event.data?.provider === 'string' && event.data.provider.length > 0
          ? event.data.provider
          : 'unknown';
        const model = typeof event.data?.model === 'string' && event.data.model.length > 0
          ? event.data.model
          : 'unknown';
        const routeKey = `${provider}\u0000${model}`;

        add(totals, buckets);
        add(bucketFor(routeKey), buckets);
        let dayBucket = days.get(day);
        if (dayBucket === undefined) {
          dayBucket = zero();
          days.set(day, dayBucket);
        }
        add(dayBucket, buckets);

        rows.push({
          turn: currentTurn,
          step: currentStep,
          time: stamp,
          day,
          provider,
          model,
          kind: 'compaction',
          note: 'compaction_summary',
          input: buckets.input,
          output: buckets.output,
          cacheRead: buckets.cacheRead,
          cacheWrite: buckets.cacheWrite,
          total: buckets.input + buckets.output + buckets.cacheRead + buckets.cacheWrite,
        });
        break;
      }
      case 'web/deepseek-search-llm-request': {
        const stamp = time ?? firstTime ?? 0;
        const day = localDay(stamp, offset);
        const provider = 'deepseek-official';
        const model = event.data?.body?.model ?? 'deepseek-v4-flash';
        const routeKey = `${provider}\u0000${model}`;
        const query = event.data?.body?.messages?.[0]?.content?.[0]?.text ?? '';
        const inputEst = Math.max(30, Math.ceil(query.length / 2) + 40);
        const outputEst = 180;
        const buckets = { input: inputEst, output: outputEst, cacheRead: 0, cacheWrite: 0 };

        add(totals, buckets);
        add(bucketFor(routeKey), buckets);
        let dayBucket = days.get(day);
        if (dayBucket === undefined) {
          dayBucket = zero();
          days.set(day, dayBucket);
        }
        add(dayBucket, buckets);

        const cleanQuery = query.replace(/^Perform a web search for the query:\s*/i, '').trim();
        rows.push({
          turn: currentTurn,
          step: currentStep,
          time: stamp,
          day,
          provider,
          model,
          kind: 'search',
          note: cleanQuery || 'web_search',
          input: buckets.input,
          output: buckets.output,
          cacheRead: 0,
          cacheWrite: 0,
          total: total(buckets),
          estimated: true,
        });
        break;
      }
      case 'session/title-llm-request': {
        const stamp = time ?? firstTime ?? 0;
        const day = localDay(stamp, offset);
        const route = event.data?.route;
        const provider = route?.provider ?? 'unknown';
        const model = route?.model ?? 'unknown';
        const routeKey = `${provider}\u0000${model}`;
        const promptText = event.data?.messages?.[0]?.content?.[0]?.text ?? '';
        const inputEst = Math.max(30, Math.ceil(promptText.length / 2) + 30);
        const outputEst = 20;
        const buckets = { input: inputEst, output: outputEst, cacheRead: 0, cacheWrite: 0 };

        add(totals, buckets);
        add(bucketFor(routeKey), buckets);
        let dayBucket = days.get(day);
        if (dayBucket === undefined) {
          dayBucket = zero();
          days.set(day, dayBucket);
        }
        add(dayBucket, buckets);

        rows.push({
          turn: currentTurn,
          step: currentStep,
          time: stamp,
          day,
          provider,
          model,
          kind: 'title',
          note: 'title_generation',
          input: buckets.input,
          output: buckets.output,
          cacheRead: 0,
          cacheWrite: 0,
          total: total(buckets),
          estimated: true,
        });
        break;
      }
      default:
        break;
    }
  }

  for (const row of rows) row.total = total(row);
  rows.sort((left, right) => (left.time ?? 0) - (right.time ?? 0));

  const turns = new Set(rows.map((row) => row.turn)).size;
  const modelRows = [...models.entries()]
    .map(([key, buckets]) => {
      const [provider, model] = key.split('\u0000');
      return { provider, model, ...buckets, total: total(buckets) };
    })
    .sort((left, right) => right.total - left.total);
  const dayRows = [...days.entries()]
    .map(([day, buckets]) => ({ day, ...buckets, total: total(buckets) }))
    .sort((left, right) => left.day.localeCompare(right.day));

  return {
    rows,
    totals: { ...totals, total: total(totals) },
    models: modelRows,
    days: dayRows,
    turns,
    steps,
    firstTime,
    lastTime,
    llmMs,
    toolMs,
    turnStarts: Object.fromEntries(turnStarts),
    turnEnds: Object.fromEntries(turnEnds),
  };
}

/** The newest title the log reports, or undefined. */
export function foldTitle(events) {
  let title;
  for (const event of events) {
    if (event.type !== 'session/title') continue;
    const next = event.data?.title;
    if (typeof next === 'string' && next.trim().length > 0) title = next.trim();
  }
  return title;
}
