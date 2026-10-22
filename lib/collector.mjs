/**
 * Host-side collection of cross-session token usage.
 *
 * Two sources, merged per session id:
 *  - live sessions from `ctx.sessions` (in-memory events, always current);
 *  - persisted sessions read through `ctx.sessionQuery` (cold logs, which is
 *    what makes sessions that are not open in this process visible).
 *
 * Live wins. The report ships aggregates plus one compact record per session;
 * per-turn rows are only read when the page drills into a session, so the
 * first paint stays small even with a long history.
 */
import { foldTitle, foldUsage, localDay } from './usage.mjs';

/** How many persisted sessions may be read concurrently. */
const READ_CONCURRENCY = 4;
/** Hourly buckets kept for the recent-activity chart. */
const HOUR_WINDOW_DAYS = 7;

const emptyTotals = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

/** Resolve an optional service without assuming the context proxy exposes it. */
function service(ctx, name) {
  if (typeof ctx.get === 'function') {
    const found = ctx.get(name);
    if (found !== undefined) return found;
  }
  try {
    return ctx[name];
  } catch {
    return undefined;
  }
}

function addInto(target, source) {
  target.input += source.input ?? 0;
  target.output += source.output ?? 0;
  target.cacheRead += source.cacheRead ?? 0;
  target.cacheWrite += source.cacheWrite ?? 0;
  target.total += source.total ?? 0;
}

function headerOf(session) {
  const header = session?.header ?? {};
  return {
    id: typeof header.id === 'string' ? header.id : String(header.id ?? ''),
    createdAt: typeof header.createdAt === 'number' ? header.createdAt : 0,
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    parentSession: typeof header.parentSession === 'string' ? header.parentSession : null,
    delegationDepth: typeof header.delegationDepth === 'number' ? header.delegationDepth : 0,
    agentPreset: typeof header.agentPreset === 'string' ? header.agentPreset : null,
  };
}

/**
 * Reduce one decoded log to the record the report ships.
 * @param header - normalized session header.
 * @param events - decoded events in seq order.
 * @param offsetMinutes - viewer timezone offset used to bucket days.
 * @param live - whether this record came from an in-memory session.
 */
export function summarizeSession(header, events, offsetMinutes, live) {
  const folded = foldUsage(events, { offsetMinutes });
  const prompt = firstPrompt(events);
  return {
    id: header.id,
    title: foldTitle(events) ?? fallbackTitle(prompt, header.id),
    prompt,
    createdAt: header.createdAt,
    cwd: header.cwd,
    parentSession: header.parentSession,
    delegationDepth: header.delegationDepth,
    agentPreset: header.agentPreset,
    live,
    firstTime: folded.firstTime ?? header.createdAt,
    lastTime: folded.lastTime ?? header.createdAt,
    totals: folded.totals,
    turns: folded.turns,
    steps: folded.steps,
    llmMs: folded.llmMs,
    toolMs: folded.toolMs,
    models: folded.models,
    rows: folded.rows.map((row) => ({
      turn: row.turn,
      step: row.step,
      time: row.time,
      day: row.day,
      provider: row.provider,
      model: row.model,
      kind: row.kind,
      note: row.note,
      estimated: row.estimated,
      input: row.input,
      output: row.output,
      cacheRead: row.cacheRead,
      cacheWrite: row.cacheWrite,
      total: row.total,
    })),
  };
}

function firstPrompt(events) {
  for (const event of events) {
    if (event.type !== 'user/message') continue;
    const text = textOf(event.data?.content);
    if (text !== undefined && text.trim().length > 0) return text.trim().slice(0, 240);
  }
  return null;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return undefined;
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') return part.text;
  }
  return undefined;
}

function fallbackTitle(prompt, id) {
  if (typeof prompt === 'string' && prompt.length > 0) return prompt.slice(0, 60);
  return `Session ${String(id).slice(-8)}`;
}

const routeKey = (provider, model) => `${provider}\u0000${model}`;

/**
 * A cached, incrementally invalidated collector.
 *
 * A session's entry is reused while its revision (live seq, or persisted
 * header identity) is unchanged, so repeated report reads only pay for the
 * sessions that actually moved.
 */
export class UsageCollector {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.cache = new Map();
    this.readConcurrency = options.readConcurrency ?? READ_CONCURRENCY;
  }

  /** Drop everything, for example after a profile change. */
  invalidate() {
    this.cache.clear();
  }

  /**
   * Build the aggregate report.
   * @param options.offsetMinutes - viewer timezone offset for day buckets.
   * @param options.rangeDays - keep only the last N local days; 0 means all.
   */
  async collect(options = {}) {
    const offsetMinutes = Number.isFinite(options.offsetMinutes)
      ? Math.max(-840, Math.min(840, Math.trunc(options.offsetMinutes)))
      : -new Date().getTimezoneOffset();
    const rangeDays = Number.isFinite(options.rangeDays) && options.rangeDays > 0
      ? Math.min(3650, Math.trunc(options.rangeDays))
      : 0;

    const { records, errors } = await this.readAll(offsetMinutes);
    return this.buildReport(records, errors, offsetMinutes, rangeDays);
  }

  /** One session with its per-turn rows. */
  async sessionDetail(sessionId, offsetMinutes) {
    const sessions = service(this.ctx, 'sessions');
    const live = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined;
    if (live !== undefined) {
      return summarizeSession(headerOf(live), live.snapshotEvents(), offsetMinutes, true);
    }
    const query = service(this.ctx, 'sessionQuery');
    if (query === undefined) throw new Error('session query service is unavailable');
    const observation = await query.observeSession(sessionId, { projectionMode: 'none' });
    try {
      return summarizeSession(headerOf({ header: observation.header }), observation.events, offsetMinutes, false);
    } finally {
      observation[Symbol.dispose]?.();
    }
  }

  async readAll(offsetMinutes) {
    const sessions = service(this.ctx, 'sessions');
    const liveSessions = typeof sessions?.list === 'function' ? sessions.list() : [];
    const liveIds = new Set();
    const records = [];
    const errors = [];

    for (const session of liveSessions) {
      const header = headerOf(session);
      if (header.id.length === 0) continue;
      liveIds.add(header.id);
      const revision = `${session.seq}:${offsetMinutes}`;
      const cached = this.cache.get(header.id);
      if (cached !== undefined && cached.revision === revision && cached.live) {
        records.push(cached.record);
        continue;
      }
      try {
        const record = summarizeSession(header, session.snapshotEvents(), offsetMinutes, true);
        this.cache.set(header.id, { revision, live: true, record });
        records.push(record);
      } catch (error) {
        errors.push({ id: header.id, message: messageOf(error) });
      }
    }

    const query = service(this.ctx, 'sessionQuery');
    if (query !== undefined && typeof query.listSessions === 'function') {
      let listed = [];
      try {
        listed = await query.listSessions();
      } catch (error) {
        errors.push({ id: '*', message: messageOf(error) });
      }
      const cold = listed.filter((entry) => {
        const id = entry?.header?.id;
        return typeof id === 'string' && !liveIds.has(id);
      });
      const results = await mapLimit(cold, this.readConcurrency, async (entry) => {
        const header = headerOf({ header: entry.header });
        const revision = `${header.createdAt}:${offsetMinutes}`;
        const cached = this.cache.get(header.id);
        if (cached !== undefined && !cached.live && cached.revision === revision) return cached.record;
        try {
          const observation = await query.observeSession(header.id, { projectionMode: 'none' });
          try {
            const record = summarizeSession(header, observation.events, offsetMinutes, false);
            this.cache.set(header.id, { revision, live: false, record });
            return record;
          } finally {
            observation[Symbol.dispose]?.();
          }
        } catch (error) {
          errors.push({ id: header.id, message: messageOf(error) });
          return undefined;
        }
      });
      for (const record of results) if (record !== undefined) records.push(record);
    }

    const present = new Set(records.map((record) => record.id));
    for (const id of [...this.cache.keys()]) if (!present.has(id)) this.cache.delete(id);

    return { records, errors };
  }

  buildReport(records, errors, offsetMinutes, rangeDays = 0) {
    const cutoffDay = rangeDays > 0 ? shiftDay(localDay(Date.now(), offsetMinutes), -(rangeDays - 1)) : undefined;
    const inRange = (row) => cutoffDay === undefined || row.day >= cutoffDay;

    records.sort((left, right) => (right.lastTime ?? 0) - (left.lastTime ?? 0));

    const totals = emptyTotals();
    const days = new Map();
    const hours = new Map();
    const models = new Map();
    const cwds = new Map();
    const sessions = [];
    let turns = 0;
    let steps = 0;

    const hourFloor = Date.now() - HOUR_WINDOW_DAYS * 86_400_000;

    for (const record of records) {
      const rows = cutoffDay === undefined ? record.rows : record.rows.filter(inRange);
      if (cutoffDay !== undefined && rows.length === 0) continue;

      const recordTotals = emptyTotals();
      const recordModels = new Map();
      const recordDays = new Set();
      const recordTurns = new Set();
      for (const row of rows) {
        addInto(recordTotals, row);
        recordDays.add(row.day);
        recordTurns.add(row.turn);
        const key = routeKey(row.provider, row.model);
        const bucket = recordModels.get(key) ?? { provider: row.provider, model: row.model, ...emptyTotals() };
        addInto(bucket, row);
        recordModels.set(key, bucket);
      }

      addInto(totals, recordTotals);
      turns += recordTurns.size;

      for (const model of recordModels.values()) {
        const key = routeKey(model.provider, model.model);
        let bucket = models.get(key);
        if (bucket === undefined) {
          bucket = { provider: model.provider, model: model.model, ...emptyTotals(), sessions: 0 };
          models.set(key, bucket);
        }
        addInto(bucket, model);
        bucket.sessions += 1;
      }

      const daysSeen = cutoffDay === undefined ? record.rows : rows;
      for (const row of daysSeen) {
        let day = days.get(row.day);
        if (day === undefined) {
          day = { day: row.day, ...emptyTotals(), sessions: new Set() };
          days.set(row.day, day);
        }
        addInto(day, row);
        day.sessions.add(record.id);
        if (row.time >= hourFloor) {
          const hour = new Date(row.time + offsetMinutes * 60_000).toISOString().slice(0, 13);
          let bucket = hours.get(hour);
          if (bucket === undefined) {
            bucket = { hour, ...emptyTotals() };
            hours.set(hour, bucket);
          }
          addInto(bucket, row);
        }
      }

      const cwdKey = record.cwd.length > 0 ? record.cwd : '(未记录工作目录)';
      let cwd = cwds.get(cwdKey);
      if (cwd === undefined) {
        cwd = { cwd: cwdKey, ...emptyTotals(), sessions: 0 };
        cwds.set(cwdKey, cwd);
      }
      addInto(cwd, recordTotals);
      cwd.sessions += 1;

      const { rows: _rows, ...rest } = record;
      let firstRowTime = Infinity;
      let lastRowTime = 0;
      for (const row of rows) {
        if (row.time < firstRowTime) firstRowTime = row.time;
        if (row.time > lastRowTime) lastRowTime = row.time;
      }
      sessions.push({
        ...rest,
        totals: recordTotals,
        turns: recordTurns.size,
        models: [...recordModels.values()].sort((left, right) => right.total - left.total),
        firstTime: firstRowTime,
        lastTime: lastRowTime,
        days: [...recordDays].sort(),
        rowCount: rows.length,
      });
      steps += record.steps;
    }

    const dayRows = trimEmptyEnds(
      [...days.values()]
        .map((day) => ({ ...day, sessions: day.sessions.size }))
        .sort((left, right) => left.day.localeCompare(right.day)),
    );
    fillDayGaps(dayRows);

    return {
      generatedAt: Date.now(),
      offsetMinutes,
      rangeDays,
      cutoffDay,
      totals: {
        ...totals,
        sessions: sessions.length,
        live: sessions.filter((session) => session.live).length,
        turns,
        steps,
      },
      sessions,
      models: [...models.values()].sort((left, right) => right.total - left.total),
      days: dayRows,
      hours: [...hours.values()].sort((left, right) => left.hour.localeCompare(right.hour)),
      cwds: [...cwds.values()].sort((left, right) => right.total - left.total),
      errors,
    };
  }
}

/** Shift a `YYYY-MM-DD` label by whole days. */
function shiftDay(day, deltaDays) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

/** Drop leading and trailing days with no usage so the axis starts at real work. */
function trimEmptyEnds(days) {
  let start = 0;
  let end = days.length;
  while (start < end && stackOf(days[start]) === 0) start += 1;
  while (end > start && stackOf(days[end - 1]) === 0) end -= 1;
  return start === 0 && end === days.length ? days : days.slice(start, end);
}

function stackOf(day) {
  return (day.input ?? 0) + (day.output ?? 0) + (day.cacheRead ?? 0) + (day.cacheWrite ?? 0);
}

function fillDayGaps(days) {
  if (days.length < 2) return;
  const present = new Map(days.map((day) => [day.day, day]));
  const start = Date.parse(`${days[0].day}T00:00:00Z`);
  const end = Date.parse(`${days[days.length - 1].day}T00:00:00Z`);
  const filled = [];
  for (let cursor = start; cursor <= end; cursor += 86_400_000) {
    const day = new Date(cursor).toISOString().slice(0, 10);
    filled.push(present.get(day) ?? { day, ...emptyTotals(), sessions: 0, models: {}, empty: true });
  }
  days.length = 0;
  days.push(...filled);
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run);
  await Promise.all(workers);
  return results;
}
