/**
 * Strip a decoded event to just the fields the usage fold actually reads.
 *
 * Caching these instead of whole logs is what makes a warm start cheap: the
 * measured store holds 89 MB of events for 3.9 MB of usage-relevant ones (96%
 * smaller), and replaying the stripped list reproduces the full fold exactly.
 *
 * The original `type` is preserved on purpose. `assistant/attempt` and
 * `assistant/message` share one code path in the fold, where a later sample for
 * the same (turn, step) replaces the earlier one. Collapsing both into a single
 * type would lose that distinction and double-count a retried step.
 */

function streamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const entry = stream[index];
    if (entry?.chunk?.type === 'usage' && entry.chunk.usage !== undefined) return entry.chunk.usage;
  }
  return undefined;
}

function usageOf(data) {
  if (data?.usage !== undefined) return data.usage;
  return streamUsage(data?.stream);
}

/** Returns a compact event, or undefined when the fold would ignore it. */
export function shapeEvent(event) {
  const type = event?.type;
  const time = event?.time;
  const seq = event?.seq;
  const data = event?.data;
  const turn = data?.turn;
  const step = data?.step;

  switch (type) {
    case 'assistant/message':
    case 'assistant/attempt': {
      const usage = usageOf(data);
      if (usage === undefined) return undefined;
      const source = data?.message?.source;
      const shaped = {
        type,
        time,
        seq,
        data: {
          turn,
          step,
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
          },
        },
      };
      if (source !== undefined && typeof source?.provider === 'string' && typeof source?.model === 'string') {
        shaped.data.message = { source: { provider: source.provider, model: source.model } };
      }
      return shaped;
    }

    case 'web/deepseek-search-llm-request':
      return {
        type,
        time,
        seq,
        data: { turn, step, body: { model: data?.body?.model, messages: data?.body?.messages } },
      };

    case 'session/title-llm-request':
      return { type, time, seq, data: { turn, step, route: data?.route, messages: data?.messages } };

    case 'tool/call':
      return { type, time, seq, data: { callId: data?.callId, name: data?.name, arguments: data?.arguments, turn, step } };

    case 'tool/result':
      return { type, time, seq, data: { message: { toolCallId: data?.message?.toolCallId } } };

    case 'turn/start':
      return { type, time, seq, data: { turn } };

    case 'step/end':
      return { type, time, seq, data: {} };

    case 'compaction/summary':
      // Compacting a context is its own billed model call; the fold reads the
      // usage plus the route, so both must survive shaping.
      return {
        type,
        time,
        seq,
        data: { provider: data?.provider, model: data?.model, usage: data?.usage },
      };

    case 'session/title':
      // foldTitle reads `data.title`; dropping it leaves the session table
      // showing "Session <id>" instead of the real name.
      return { type, time, seq, data: { title: data?.title } };

    default:
      // Types the fold ignores: keep only identity so seq ordering survives.
      return { type, time, seq };
  }
}

/** Shape a whole decoded log. */
export function shapeEvents(events) {
  const out = [];
  for (const event of events) {
    const shaped = shapeEvent(event);
    if (shaped !== undefined) out.push(shaped);
  }
  return out;
}

/** The highest seq present, so an incremental read knows where to resume. */
export function highestSeq(events) {
  let highest;
  for (const event of events) {
    if (typeof event?.seq !== 'number') continue;
    if (highest === undefined || event.seq > highest) highest = event.seq;
  }
  return highest;
}
