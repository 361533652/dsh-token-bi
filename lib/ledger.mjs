/**
 * Persistent ledger for the token bill — a local SQLite database.
 *
 * ## Why a database instead of a rebuild
 *
 * The panel used to fold every session log on every cold start: 225 logs and
 * ~184 MB of zstd-compressed events to decode, one by one, before a single
 * number could be painted. That is seconds of work to answer a question whose
 * answer barely changed. The ledger flips that around — the logs are read
 * incrementally, once, and the aggregate lives on disk:
 *
 * - **Append-only reading.** Each session records the `seq` it was folded up to;
 *   a read resumes at the end of the log. A turn costs milliseconds, not a full
 *   scan.
 * - **Aggregates, not copies.** The stored table is day × provider × model ×
 *   cwd, so a report is one `SELECT`, not a fold over thousands of rows.
 * - **The bill outlives the conversation.** Deleting a session removes its log
 *   but not its bill; the ledger keeps what was already spent.
 *
 * ## What is authoritative
 *
 * The ledger is derived data: the logs are the source of truth, and a rebuild
 * can always regenerate it. But once a session's log is gone, the ledger is the
 * only surviving record of its spend — so nothing here deletes rows merely
 * because a log disappeared.
 *
 * @module lib/ledger.mjs
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Bumped whenever the table layout changes; an older file is rebuilt. */
const SCHEMA_VERSION = 1;

const SCHEMA = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  /* One row per (day, provider, model, workspace). The unit the charts read. */
  CREATE TABLE IF NOT EXISTS usage (
    day          TEXT    NOT NULL,
    provider     TEXT    NOT NULL,
    model        TEXT    NOT NULL,
    cwd          TEXT    NOT NULL,
    input        INTEGER NOT NULL DEFAULT 0,
    output       INTEGER NOT NULL DEFAULT 0,
    cache_read   INTEGER NOT NULL DEFAULT 0,
    cache_write  INTEGER NOT NULL DEFAULT 0,
    calls        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, provider, model, cwd)
  ) WITHOUT ROWID;

  /* One row per session. Kept even after its log is deleted. */
  CREATE TABLE IF NOT EXISTS session (
    id          TEXT PRIMARY KEY,
    title       TEXT,
    cwd         TEXT,
    parent      TEXT,
    depth       INTEGER NOT NULL DEFAULT 0,
    live        INTEGER NOT NULL DEFAULT 0,
    first_time  INTEGER NOT NULL DEFAULT 0,
    last_time   INTEGER NOT NULL DEFAULT 0,
    added_at    INTEGER NOT NULL DEFAULT 0,
    gone        INTEGER NOT NULL DEFAULT 0,
    days        TEXT NOT NULL DEFAULT ''
  ) WITHOUT ROWID;

  /* Which log sequence a session has been folded up to. */
  CREATE TABLE IF NOT EXISTS progress (
    id       TEXT PRIMARY KEY,
    upto_seq INTEGER NOT NULL DEFAULT 0,
    rev      TEXT,
    seen_at  INTEGER NOT NULL DEFAULT 0
  ) WITHOUT ROWID;

  /* Per-session per-day totals, so a day-filtered row shows that day's number. */
  CREATE TABLE IF NOT EXISTS session_day (
    id    TEXT    NOT NULL,
    day   TEXT    NOT NULL,
    input INTEGER NOT NULL DEFAULT 0,
    output INTEGER NOT NULL DEFAULT 0,
    cache_read  INTEGER NOT NULL DEFAULT 0,
    cache_write INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id, day)
  ) WITHOUT ROWID;

  /* Which day each turn belongs to, so a window can be recounted locally. */
  CREATE TABLE IF NOT EXISTS session_turn (
    id    TEXT    NOT NULL,
    turn  INTEGER NOT NULL,
    day   TEXT    NOT NULL,
    PRIMARY KEY (id, turn)
  ) WITHOUT ROWID;

  /* Which models each session used, for the session-table filter. */
  CREATE TABLE IF NOT EXISTS session_model (
    id       TEXT NOT NULL,
    provider TEXT NOT NULL,
    model    TEXT NOT NULL,
    total    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (id, provider, model)
  ) WITHOUT ROWID;

  CREATE INDEX IF NOT EXISTS usage_day ON usage (day);
  CREATE INDEX IF NOT EXISTS session_day_id ON session_day (id);
  CREATE INDEX IF NOT EXISTS session_turn_day ON session_turn (day);
`;

/** The database path for one session store. */
export function ledgerPath(root) {
  return join(root, '.token-bi-cache', 'ledger.db');
}

/**
 * Open the ledger, creating and migrating it as needed.
 *
 * Returns `undefined` when the store root is unavailable or the runtime has no
 * SQLite — the caller then falls back to folding logs, so a missing ledger
 * degrades to "slower", never to "broken".
 */
export function openLedger(root) {
  try {
    const dir = join(root, '.token-bi-cache');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(ledgerPath(root));
    db.exec(SCHEMA);
    // `user_version` is SQLite's own schema marker: cheap to read, and it
    // survives in the file itself rather than needing a sidecar.
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    if (version !== SCHEMA_VERSION) {
      // A layout change makes old aggregates untrustworthy; drop them and let
      // the logs refill the ledger. Sessions whose log is gone lose their rows,
      // which is the honest outcome of a schema break.
      if (version !== 0) {
        db.exec('DROP TABLE IF EXISTS usage; DROP TABLE IF EXISTS session; DROP TABLE IF EXISTS progress;'
          + ' DROP TABLE IF EXISTS session_day; DROP TABLE IF EXISTS session_turn; DROP TABLE IF EXISTS session_model;');
        db.exec(SCHEMA);
      }
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    return db;
  } catch {
    return undefined;
  }
}

/** The `seq` a session was folded up to, plus the log revision when known. */
export function progressOf(db, id) {
  try {
    const row = db.prepare('SELECT upto_seq, rev FROM progress WHERE id = ?').get(id);
    if (row === undefined) return undefined;
    return { uptoSeq: Number(row.upto_seq) || 0, rev: typeof row.rev === 'string' ? row.rev : undefined };
  } catch {
    return undefined;
  }
}

export function saveProgress(db, id, uptoSeq, rev) {
  db.prepare('INSERT INTO progress (id, upto_seq, rev, seen_at) VALUES (?, ?, ?, ?)'
    + ' ON CONFLICT(id) DO UPDATE SET upto_seq = excluded.upto_seq, rev = excluded.rev, seen_at = excluded.seen_at')
    .run(id, uptoSeq, rev ?? null, Date.now());
}

/**
 * Add usage to the aggregate table.
 *
 * Rows are **added**, not replaced: a fold emits only the events after the last
 * recorded `seq`, so every call here is genuinely new spend. Replacement only
 * happens on a full rebuild, which clears the table first.
 */
export function addUsage(db, rows) {
  if (rows.length === 0) return;
  const upsert = db.prepare(`
    INSERT INTO usage (day, provider, model, cwd, input, output, cache_read, cache_write, calls)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, provider, model, cwd) DO UPDATE SET
      input = input + excluded.input,
      output = output + excluded.output,
      cache_read = cache_read + excluded.cache_read,
      cache_write = cache_write + excluded.cache_write,
      calls = calls + excluded.calls
  `);
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      upsert.run(row.day, row.provider, row.model, row.cwd, row.input ?? 0, row.output ?? 0, row.cacheRead ?? 0, row.cacheWrite ?? 0, row.calls ?? 0);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Write a session's metadata plus its per-day, per-turn and per-model rows. */
/**
 * Write a session's metadata and append its spend.
 *
 * The session tables are written from the *whole* fold of that session (a live
 * one is small and in memory; a persisted one is folded in full on first sight
 * and only its tail afterwards). The aggregate `usage` table is different: it
 * is **appended**, because a tail fold only knows about the new events. Writing
 * it as a replacement would erase everything a session spent earlier.
 *
 * @param session - the folded session record.
 * @param usageRows - new (day × provider × model × cwd) spend to add, or
 *   `undefined` to derive it from `session.rows` (first sight / full rebuild).
 */
export function upsertSession(db, session, usageRows) {
  const days = session.days ?? [];
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO session (id, title, cwd, parent, depth, live, first_time, last_time, added_at, gone, days)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, cwd = excluded.cwd, parent = excluded.parent, depth = excluded.depth,
        live = excluded.live, first_time = excluded.first_time, last_time = excluded.last_time,
        days = excluded.days, gone = 0
    `).run(
      session.id, session.title ?? '', session.cwd ?? '', session.parentSession ?? null,
      session.delegationDepth ?? 0, session.live ? 1 : 0,
      session.firstTime ?? 0, session.lastTime ?? 0, Date.now(), days.join(','),
    );

    // Per-day totals: keep the largest of (what is stored, what we just folded)
    // rather than blindly replacing. A tail fold only reports the days its new
    // events touched, so a blind replace would delete the days it did not see.
    const dayUpsert = db.prepare(`
      INSERT INTO session_day (id, day, input, output, cache_read, cache_write)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id, day) DO UPDATE SET
        input = MAX(input, excluded.input),
        output = MAX(output, excluded.output),
        cache_read = MAX(cache_read, excluded.cache_read),
        cache_write = MAX(cache_write, excluded.cache_write)
    `);
    for (const [day, buckets] of Object.entries(session.dayTotals ?? {})) {
      dayUpsert.run(session.id, day, buckets.input ?? 0, buckets.output ?? 0, buckets.cacheRead ?? 0, buckets.cacheWrite ?? 0);
    }

    const turnUpsert = db.prepare('INSERT OR REPLACE INTO session_turn (id, turn, day) VALUES (?, ?, ?)');
    for (const [turn, day] of Object.entries(session.turnDays ?? {})) {
      turnUpsert.run(session.id, Number(turn), String(day));
    }

    const modelUpsert = db.prepare(`
      INSERT INTO session_model (id, provider, model, total) VALUES (?, ?, ?, ?)
      ON CONFLICT(id, provider, model) DO UPDATE SET total = MAX(total, excluded.total)
    `);
    for (const model of session.models ?? []) {
      modelUpsert.run(session.id, model.provider ?? '', model.model ?? '', model.total ?? 0);
    }

    if (Array.isArray(usageRows) && usageRows.length > 0) addUsageRows(db, usageRows);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Append spend rows; assumes the caller owns the transaction. */
function addUsageRows(db, rows) {
  const upsert = db.prepare(`
    INSERT INTO usage (day, provider, model, cwd, input, output, cache_read, cache_write, calls)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(day, provider, model, cwd) DO UPDATE SET
      input = input + excluded.input,
      output = output + excluded.output,
      cache_read = cache_read + excluded.cache_read,
      cache_write = cache_write + excluded.cache_write,
      calls = calls + excluded.calls
  `);
  for (const row of rows) {
    upsert.run(row.day, row.provider, row.model, row.cwd, row.input ?? 0, row.output ?? 0, row.cacheRead ?? 0, row.cacheWrite ?? 0, row.calls ?? 0);
  }
}

/**
 * The whole ledger as the report shape the page already consumes.
 *
 * Every number is re-derived from the tables, so a report is a handful of
 * scans rather than a fold over the logs.
 */
export function readLedgerReport(db, offsetMinutes) {
  const usage = db.prepare('SELECT day, provider, model, cwd, input, output, cache_read, cache_write, calls FROM usage').all();
  const cells = usage.map((row) => ({
    day: String(row.day),
    provider: String(row.provider),
    model: String(row.model),
    cwd: String(row.cwd),
    input: Number(row.input) || 0,
    output: Number(row.output) || 0,
    cacheRead: Number(row.cache_read) || 0,
    cacheWrite: Number(row.cache_write) || 0,
    total: (Number(row.input) || 0) + (Number(row.output) || 0) + (Number(row.cache_read) || 0) + (Number(row.cache_write) || 0),
    calls: Number(row.calls) || 0,
  }));

  const dayMap = new Map();
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  for (const cell of cells) {
    let day = dayMap.get(cell.day);
    if (day === undefined) {
      day = { day: cell.day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: 0, sessions: 0 };
      dayMap.set(cell.day, day);
    }
    day.input += cell.input;
    day.output += cell.output;
    day.cacheRead += cell.cacheRead;
    day.cacheWrite += cell.cacheWrite;
    day.total += cell.total;
    day.calls += cell.calls;
    totals.input += cell.input;
    totals.output += cell.output;
    totals.cacheRead += cell.cacheRead;
    totals.cacheWrite += cell.cacheWrite;
    totals.total += cell.total;
  }

  // Sessions present in the ledger but with their log deleted still count: the
  // bill is a record of what was spent, not of what still exists on disk.
  const sessions = db.prepare(`
    SELECT id, title, cwd, parent, depth, live, first_time, last_time, days FROM session
  `).all().map((row) => {
    const dayRows = db.prepare('SELECT day, input, output, cache_read, cache_write FROM session_day WHERE id = ?').all(row.id);
    const dayTotals = {};
    const sessionTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    for (const day of dayRows) {
      const buckets = {
        input: Number(day.input) || 0,
        output: Number(day.output) || 0,
        cacheRead: Number(day.cache_read) || 0,
        cacheWrite: Number(day.cache_write) || 0,
        total: 0,
      };
      buckets.total = buckets.input + buckets.output + buckets.cacheRead + buckets.cacheWrite;
      dayTotals[day.day] = buckets;
      sessionTotals.input += buckets.input;
      sessionTotals.output += buckets.output;
      sessionTotals.cacheRead += buckets.cacheRead;
      sessionTotals.cacheWrite += buckets.cacheWrite;
      sessionTotals.total += buckets.total;
    }
    const turnRows = db.prepare('SELECT turn, day FROM session_turn WHERE id = ?').all(row.id);
    const turnDays = {};
    for (const turn of turnRows) turnDays[Number(turn.turn)] = String(turn.day);
    const models = db.prepare('SELECT provider, model, total FROM session_model WHERE id = ?').all(row.id)
      .map((model) => ({ provider: String(model.provider), model: String(model.model), total: Number(model.total) || 0 }));
    return {
      id: String(row.id),
      title: String(row.title ?? ''),
      cwd: String(row.cwd ?? ''),
      parentSession: row.parent === null ? null : String(row.parent),
      delegationDepth: Number(row.depth) || 0,
      live: Number(row.live) === 1,
      firstTime: Number(row.first_time) || 0,
      lastTime: Number(row.last_time) || 0,
      totals: sessionTotals,
      turns: Object.keys(turnDays).length,
      models,
      days: String(row.days ?? '').length === 0 ? [] : String(row.days).split(','),
      dayTotals,
      turnDays,
    };
  });

  // Sessions that were never deleted but whose logs are gone keep their `days`.
  for (const session of sessions) {
    for (const day of session.days) {
      const entry = dayMap.get(day);
      if (entry !== undefined) entry.sessions += 1;
    }
  }

  const days = [...dayMap.values()].sort((left, right) => left.day.localeCompare(right.day));
  const models = (() => {
    const map = new Map();
    for (const cell of cells) {
      const key = `${cell.provider}\u0000${cell.model}`;
      let bucket = map.get(key);
      if (bucket === undefined) {
        bucket = { provider: cell.provider, model: cell.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, sessions: 0 };
        map.set(key, bucket);
      }
      bucket.input += cell.input;
      bucket.output += cell.output;
      bucket.cacheRead += cell.cacheRead;
      bucket.cacheWrite += cell.cacheWrite;
      bucket.total += cell.total;
    }
    for (const session of sessions) {
      const seen = new Set((session.models ?? []).map((model) => `${model.provider}\u0000${model.model}`));
      for (const key of seen) {
        const bucket = map.get(key);
        if (bucket !== undefined) bucket.sessions += 1;
      }
    }
    return [...map.values()].sort((left, right) => right.total - left.total);
  })();

  const cwds = (() => {
    const map = new Map();
    for (const cell of cells) {
      let bucket = map.get(cell.cwd);
      if (bucket === undefined) {
        bucket = { cwd: cell.cwd, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, sessions: 0 };
        map.set(cell.cwd, bucket);
      }
      bucket.input += cell.input;
      bucket.output += cell.output;
      bucket.cacheRead += cell.cacheRead;
      bucket.cacheWrite += cell.cacheWrite;
      bucket.total += cell.total;
    }
    for (const session of sessions) {
      const bucket = map.get(session.cwd);
      if (bucket !== undefined) bucket.sessions += 1;
    }
    return [...map.values()].sort((left, right) => right.total - left.total);
  })();

  const tools = db.prepare(`
    SELECT provider, model, SUM(calls) AS calls FROM usage
    WHERE calls > 0 AND (model = 'tool-search' OR model = 'tool-fetch')
    GROUP BY provider, model
  `).all().map((row) => ({
    provider: String(row.provider),
    model: String(row.model),
    kind: String(row.model) === 'tool-fetch' ? 'fetch' : 'search',
    calls: Number(row.calls) || 0,
  })).sort((left, right) => right.calls - left.calls);

  return {
    generatedAt: Date.now(),
    offsetMinutes,
    rangeDays: 0,
    totals: {
      ...totals,
      sessions: sessions.length,
      live: sessions.filter((session) => session.live).length,
      turns: sessions.reduce((sum, session) => sum + session.turns, 0),
      steps: 0,
    },
    sessions: sessions.sort((left, right) => right.lastTime - left.lastTime),
    models,
    cwds,
    tools,
    days,
    cells,
    hours: [],
    errors: [],
  };
}

/** Every session id the ledger knows, so a missing log is not mistaken for new. */
export function knownSessionIds(db) {
  try {
    return new Set(db.prepare('SELECT id FROM session').all().map((row) => String(row.id)));
  } catch {
    return new Set();
  }
}

/** Whether the ledger has ever been populated (a fresh install has not). */
export function ledgerIsEmpty(db) {
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM session').get();
    return (Number(row?.n) || 0) === 0;
  } catch {
    return true;
  }
}

/** Forget an aggregate row entirely (used by a full rebuild). */
export function clearLedger(db) {
  db.exec('BEGIN');
  try {
    for (const table of ['usage', 'session', 'progress', 'session_day', 'session_turn', 'session_model']) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export { SCHEMA_VERSION };
