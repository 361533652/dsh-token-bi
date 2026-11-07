/**
 * Fold the session logs into the persistent ledger.
 *
 * ## The incremental contract
 *
 * Each session records the `seq` it was folded up to. A sync asks the host for
 * events after that seq, and the fold result is **added** to the aggregate
 * tables. A session that has not moved costs one header read and no log
 * parsing at all.
 *
 * This is what makes the panel open instantly: decoding hundreds of megabytes
 * of event streams happens once per session across the turns that produce it,
 * instead of on every cold start.
 *
 * ## What "delete the session" means
 *
 * A session log can disappear from disk while its ledger row stays. The bill
 * records what was spent, so losing the conversation must not erase the fact
 * that it was paid for. Rows are only removed by an explicit rebuild.
 *
 * @module lib/sync.mjs
 */
import { summarizeSession } from './collector.mjs';
import { clearLedger, knownSessionIds, progressOf, readLedgerReport, saveProgress, upsertSession } from './ledger.mjs';

/**
 * Per-day totals, per-turn day map and model list, derived from a fold's rows.
 *
 * `summarizeSession` returns the rows only; these are the aggregates the report
 * needs and the ledger stores, so they are computed once here rather than by
 * re-walking the rows in three places.
 */
function deriveSession(record) {
  const dayTotals = {};
  const turnDays = {};
  const models = new Map();
  for (const row of record.rows ?? []) {
    if (typeof row.day !== 'string' || row.day.length === 0) continue;
    let day = dayTotals[row.day];
    if (day === undefined) {
      day = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      dayTotals[row.day] = day;
    }
    day.input += countOf(row.input);
    day.output += countOf(row.output);
    day.cacheRead += countOf(row.cacheRead);
    day.cacheWrite += countOf(row.cacheWrite);

    if (typeof row.turn === 'number' && turnDays[row.turn] === undefined) turnDays[row.turn] = row.day;

    const key = `${row.provider ?? ''}\u0000${row.model ?? ''}`;
    let model = models.get(key);
    if (model === undefined) {
      model = { provider: row.provider ?? 'unknown', model: row.model ?? 'unknown', total: 0 };
      models.set(key, model);
    }
    model.total += countOf(row.input) + countOf(row.output) + countOf(row.cacheRead) + countOf(row.cacheWrite);
  }
  return {
    dayTotals,
    turnDays,
    models: [...models.values()],
    turns: Object.keys(turnDays).length,
    days: Object.keys(dayTotals).sort(),
  };
}

/** A usable count, or zero — a bad number must never reach the database. */
const countOf = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** A service from the plugin context, whichever way it is exposed. */
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

/**
 * One session's spend as (day × provider × model × cwd) rows.
 *
 * These come from the folded record's own rows, which carry the provider, model
 * and day of every settlement — the exact tuples the charts aggregate.
 */
function usageRows(record) {
  const rows = [];
  for (const row of record.rows ?? []) {
    if (typeof row.day !== 'string' || row.day.length === 0) continue;
    rows.push({
      day: row.day,
      // The session dimension is what lets a re-fold replace this session's
      // share without touching another session's rows on the same tuple.
      sessionId: record.id,
      provider: typeof row.provider === 'string' && row.provider.length > 0 ? row.provider : 'unknown',
      model: typeof row.model === 'string' && row.model.length > 0 ? row.model : 'unknown',
      cwd: typeof record.cwd === 'string' && record.cwd.length > 0 ? record.cwd : '(no workspace)',
      input: countOf(row.input),
      output: countOf(row.output),
      cacheRead: countOf(row.cacheRead),
      cacheWrite: countOf(row.cacheWrite),
      calls: countOf(row.apiCalls),
    });
  }
  return rows;
}

/** Fold the events after `fromSeq`, or all of them. */
async function foldSession(ctx, entry, offsetMinutes, fromSeq) {
  const { header, liveSession } = entry;

  if (liveSession !== undefined) {
    // Live sessions are held in memory and are small; the fold is cheap and
    // always reflects the newest state.
    //
    // The returned `seq` is the highest seq actually present in those events,
    // **not** `liveSession.seq`. The memory value can run ahead of the snapshot
    // (or behind it, right after a replay), and using it as the fold watermark
    // makes a session skip its own tail forever.
    const events = liveSession.snapshotEvents();
    const sliced = fromSeq === undefined ? events : events.filter((event) => (Number(event.seq) || 0) > fromSeq);
    return { events: sliced, seq: highestSeq(sliced), live: true };
  }

  const query = service(ctx, 'sessionQuery');
  if (typeof query?.observeSession !== 'function') throw new Error('session query service is unavailable');
  const observation = await query.observeSession(header.id, {
    projectionMode: 'none',
    ...(fromSeq === undefined ? {} : { fromSeq: fromSeq + 1 }),
  });
  try {
    const events = observation.events ?? [];
    const sliced = fromSeq === undefined ? events : events.filter((event) => (Number(event.seq) || 0) > fromSeq);
    return { events: sliced, seq: highestSeq(sliced), live: false };
  } finally {
    observation[Symbol.dispose]?.();
  }
}

const highestSeq = (events) => events.reduce((max, event) => Math.max(max, Number(event.seq) || 0), 0);

/**
 * Rebuild the ledger from scratch.
 *
 * Used when the database is new, corrupt, or its schema changed. Every session
 * is folded in full and the aggregate tables are cleared first, so a rebuild is
 * idempotent — it can run any number of times and always yields the numbers the
 * logs currently imply.
 *
 * Sessions whose logs no longer exist are lost here: a rebuild is the one
 * operation that cannot recover spend whose source has been deleted.
 */
export async function rebuildLedger(ctx, db, offsetMinutes, options = {}) {
  clearLedger(db);
  const result = await syncLedger(ctx, db, offsetMinutes, options);
  return result;
}

/**
 * Bring the ledger up to date.
 *
 * @param options.skipListed - when true, only live sessions are considered.
 *   `listSessions()` walks every session directory on disk (~500 ms on a 222
 *   session store) and is what a second open inside the cache window pays for
 *   nothing. The caller skips it when it already trusts the ledger.
 * @returns {Promise<{ report, folded, reused, errors }>}
 */
export async function syncLedger(ctx, db, offsetMinutes, options = {}) {
  const errors = [];
  const entries = new Map();

  // Live sessions first: they are the ones being written right now.
  const sessionsService = service(ctx, 'sessions');
  const liveSessions = typeof sessionsService?.list === 'function' ? sessionsService.list() : [];
  for (const session of liveSessions) {
    const header = session?.header;
    if (typeof header?.id !== 'string' || header.id.length === 0) continue;
    entries.set(header.id, { header, liveSession: session });
  }

  if (options.skipListed === true) {
    // Fast path: fold only the sessions that are actually live. A persisted
    // session cannot gain usage without its directory being touched, and the
    // next full sync will pick that up.
    return finish(ctx, entries, db, offsetMinutes, errors, options);
  }

  // Then every persisted session the host knows about.
  const query = service(ctx, 'sessionQuery');
  if (typeof query?.listSessions === 'function') {
    let listed = [];
    try {
      listed = await query.listSessions();
    } catch (error) {
      errors.push({ id: '*', message: error instanceof Error ? error.message : String(error) });
    }
    for (const entry of listed) {
      const header = entry?.header;
      if (typeof header?.id !== 'string' || header.id.length === 0) continue;
      if (entries.has(header.id)) continue;
      entries.set(header.id, { header, liveSession: undefined });
    }
  }

  // Only the full path can see which logs disappeared.
  markDeleted(ctx, db, entries);
  return finish(ctx, entries, db, offsetMinutes, errors, options);
}

/**
 * Mark sessions whose log is gone.
 *
 * Only the full path can know this: the fast path deliberately never lists the
 * store, so it cannot tell "deleted" from "not looked at".
 */
function markDeleted(ctx, db, entries) {
  const known = knownSessionIds(db);
  for (const id of known) {
    if (!entries.has(id)) {
      try {
        db.prepare('UPDATE session SET gone = 1 WHERE id = ?').run(id);
      } catch {
        // A cosmetic flag; never fail a sync over it.
      }
    }
  }
}

/**
 * Fold every entry that moved and return the report.
 *
 * Shared by both sync paths: the full one hands it every known session, the
 * fast one hands it only the live sessions.
 */
async function finish(ctx, entries, db, offsetMinutes, errors, options) {
  let folded = 0;
  let reused = 0;
  let added = 0;

  for (const [id, entry] of entries) {
    const progress = progressOf(db, id);

    // Nothing new since the last fold. This is the path a warm panel takes for
    // every session that has not moved. It compares against the events the
    // session actually holds, not its counter, for the reason spelled out in
    // `foldSession`.
    if (progress !== undefined && entry.liveSession !== undefined
      && highestSeq(entry.liveSession.snapshotEvents()) <= progress.uptoSeq) {
      reused += 1;
      continue;
    }

    try {
      // A live session is folded in full every time: it lives in memory, so
      // the fold is cheap, and a full fold is what keeps its per-day totals
      // honest. A persisted session resumes from its recorded seq, so only the
      // new tail is parsed — that is the expensive one.
      const live = entry.liveSession !== undefined;
      const fromSeq = !live && progress !== undefined && progress.uptoSeq > 0 ? progress.uptoSeq : undefined;
      const { events, seq } = await foldSession(ctx, entry, offsetMinutes, fromSeq);

      if (events.length === 0 && progress !== undefined) {
        // Nothing new; only refresh the metadata (a title can change).
        reused += 1;
        continue;
      }

      const record = summarizeSession(entry.header, events, offsetMinutes, live);
      record.id = id;
      // `summarizeSession` returns the per-turn rows; the per-day and per-turn
      // maps are a report-level derivation, so build them here from the same
      // rows the spend came from.
      const derived = deriveSession(record);

      // A full fold replaces this session's per-day rows outright (they are
      // recomputed from everything). A tail fold only knows its own new
      // settlements, so it appends to `usage` and lets `upsertSession` keep the
      // larger per-day value rather than overwriting days it never saw.
      const rows = usageRows(record);
      upsertSession(db, { ...record, ...derived }, rows, fromSeq === undefined);
      added += rows.length;
      folded += 1;

      // Record what was actually folded, never the session's in-memory seq.
      //
      // These are not the same number: a live session's `seq` reflects the
      // instant the snapshot was taken, while the events we folded may reach
      // further (or stop earlier) depending on when the snapshot was read.
      // Trusting the memory value skips log tail that has not been counted —
      // that is how a session ends up permanently missing its last few million
      // tokens, with no error anywhere.
      const foldedTo = Math.max(seq, 0);
      const upto = Math.max(progress?.uptoSeq ?? 0, foldedTo);
      saveProgress(db, id, upto, undefined);
    } catch (error) {
      errors.push({ id, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return { report: readLedgerReport(db, offsetMinutes), folded, reused, added, errors };
}
