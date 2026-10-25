/**
 * Per-session on-disk cache.
 *
 * A whole-report snapshot proved useless in practice: the session you are
 * currently chatting in appends a message every few seconds, so the store
 * fingerprint changed constantly and every read fell back to a full fold.
 *
 * Caching each session's entry instead means only the sessions that actually
 * moved get re-read. Validity is per session, from that session's own log files
 * (path, size, mtime), so an unrelated session writing cannot invalidate a quiet
 * one.
 *
 * Each entry also keeps the *shaped* events the fold consumed. Those are what
 * make a warm start cheap: a grown log only contributes its tail, which is
 * appended to the stored events and re-folded. The file is zstd-compressed
 * because the shaped events, while 96% smaller than the logs, still run to
 * ~12 MB across a full history.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';

/** Bump when the entry shape or fold rules change, invalidating old files. */
const CACHE_VERSION = 5;
const ENTRY_FILE = 'sessions-cache.json.zst';
const LOG_PATTERN = /session\.v\d+\.jsonl\.zstd$/;

/**
 * Per-session log fingerprints: session id -> digest of its logs.
 *
 * Scoped to a single session directory, so the digest for one session is
 * unaffected by activity elsewhere in the store.
 */
function sessionDigest(dir) {
  const parts = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !LOG_PATTERN.test(entry.name)) continue;
    try {
      const stat = statSync(join(dir, entry.name));
      parts.push(`${entry.name}:${stat.size}:${Math.round(stat.mtimeMs)}`);
    } catch {
      // Vanished mid-walk: treat as absent.
    }
  }
  if (parts.length === 0) return undefined;
  parts.sort();
  return createHash('sha1').update(parts.join('|')).digest('hex');
}

/** Directory holding one session's logs, given the store root and session id. */
function findSessionDir(root, sessionId) {
  let found;
  const walk = (dir) => {
    if (found !== undefined) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.endsWith(`session-${sessionId}`) || entry.name.includes(sessionId)) {
        found = join(dir, entry.name);
        return;
      }
      walk(join(dir, entry.name));
    }
  };
  walk(root);
  return found;
}

export function resolveStoreRoot(ctx) {
  try {
    const query = typeof ctx.get === 'function' ? ctx.get('sessionQuery') : ctx.sessionQuery;
    const root = query?._persistenceBinding?.service?.root;
    if (typeof root === 'string' && root.length > 0) return root;
  } catch {
    // Fall through.
  }
  const home = process.env.DSH_HOME;
  if (typeof home === 'string' && home.length > 0) return join(home, 'sessions');
  return undefined;
}

/**
 * Index every session directory in one pass, so per-session lookups do not
 * each walk the store.
 *
 * Two id spellings reach this code and they must both resolve:
 *   - directory names are `session-<uuid>`
 *   - `listSessions()` returns ids already prefixed as `session-<uuid>`
 * so each directory is registered under both the bare uuid and the prefixed
 * form. (Measured on a real store: the bare form matched nothing.)
 */
/**
 * Index every session directory in one pass, so per-session lookups do not each
 * walk the store.
 *
 * Directory names are not uniform. The store uses `session-<uuid>` for most
 * sessions but a bare `<uuid>` for some (observed for older sessions in the same
 * workspace group), and `listSessions()` reports ids as `session-<uuid>`. Each
 * directory is therefore registered under every spelling, so whichever form the
 * Host hands us resolves.
 */
export function indexSessionDirs(root) {
  const index = new Map();
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      const prefixed = /^session-([0-9a-f-]{8,})$/i.exec(entry.name);
      const bare = /^([0-9a-f-]{8,})$/i.exec(entry.name);
      if (prefixed !== null) {
        index.set(entry.name, path);
        index.set(prefixed[1], path);
      } else if (bare !== null) {
        index.set(entry.name, path);
        index.set(`session-${bare[1]}`, path);
      }
      walk(path);
    }
  };
  walk(root);
  return index;
}

/**
 * A durable per-session entry store backed by one JSON file.
 *
 * Each entry keeps two things:
 *
 *   - `record`: the folded session record the report ships (small);
 *   - `events`: the *shaped* events the fold consumed (96% smaller than the
 *     logs they came from).
 *
 * The shaped events are what makes a warm start cheap. When a log grows, only
 * the events after `seq` are read, appended to `events`, and the record is
 * re-folded from the stored events plus the new ones. That replays the exact
 * replace-not-add rule for repeated (turn, step) samples, which a simple
 * "add the delta" scheme cannot preserve.
 */
export function createSessionStore(root, options = {}) {
  const cache = loadSessionCache(root);
  const dirs = indexSessionDirs(root);
  const offsetMinutes = options.offsetMinutes;
  let dirty = false;

  return {
    dirFor(sessionId) {
      return dirs.get(sessionId);
    },
    digestFor(dir) {
      return sessionDigest(dir);
    },
    lookup(sessionId, digest, offset) {
      return lookupSession(cache, sessionId, digest, offset);
    },
    /** The stored shape events for a session, when they can be continued. */
    lookupEvents(sessionId, offset) {
      const entry = cache.records.get(sessionId);
      if (entry === undefined) return undefined;
      if (entry.offsetMinutes !== offset) return undefined;
      if (typeof entry.seq !== 'number') return undefined;
      if (!Array.isArray(entry.events)) return undefined;
      return { events: entry.events, seq: entry.seq };
    },
    /**
     * Every stored record for this offset, ignoring log digests.
     *
     * This is the stale-read path: it assembles a report without touching a
     * single log, so the page can paint immediately while a fresh build runs
     * behind it. Callers must treat the result as possibly out of date.
     */
    snapshotRecords(offset) {
      const out = [];
      for (const [sessionId, entry] of cache.records) {
        if (entry?.offsetMinutes !== offset) continue;
        if (!entry.record || typeof entry.record !== 'object') continue;
        out.push({ sessionId, record: entry.record, savedAt: entry.savedAt ?? 0 });
      }
      return out;
    },
    /** When the cache file was last written, for a "as of" hint. */
    get savedAt() {
      let newest = 0;
      for (const entry of cache.records.values()) {
        if (typeof entry?.savedAt === 'number' && entry.savedAt > newest) newest = entry.savedAt;
      }
      return newest;
    },
    remember(sessionId, digest, offset, record, seq, events) {
      if (digest === undefined) return;
      const previous = cache.records.get(sessionId);
      const entry = {
        digest,
        offsetMinutes: offset,
        record,
        savedAt: Date.now(),
      };
      if (typeof seq === 'number') entry.seq = seq;
      if (Array.isArray(events)) entry.events = events;
      else if (previous?.events !== undefined) entry.events = previous.events;
      cache.records.set(sessionId, entry);
      cache.offsetMinutes = offsetMinutes;
      dirty = true;
    },
    /** Write the file if anything changed; called once per report build. */
    flush() {
      if (!dirty) return false;
      dirty = false;
      return saveSessionCache(root, cache);
    },
    get size() {
      return cache.records.size;
    },
  };
}

/**
 * A cheap whole-store fingerprint: the sum of every session log's size and
 * mtime. One directory walk, no file reads, so it costs a few milliseconds.
 *
 * Used only to decide whether a finished report is still describing the current
 * store. Any append to any session changes the sum.
 */
export function storeFingerprint(root) {
  const parts = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (LOG_PATTERN.test(entry.name)) {
        try {
          const stat = statSync(path);
          parts.push(`${stat.size}:${Math.round(stat.mtimeMs)}`);
        } catch {
          // Vanished mid-walk.
        }
      }
    }
  };
  walk(root);
  parts.sort();
  return createHash('sha1').update(parts.join(',')).digest('hex');
}

function cacheDir(root) {
  return join(root, '.token-bi-cache');
}

/** Load the per-session cache, tolerating anything unparseable. */
export function loadSessionCache(root) {
  try {
    const buffer = readFileSync(join(cacheDir(root), ENTRY_FILE));
    const parsed = JSON.parse(zstdDecompressSync(buffer).toString('utf8'));
    if (parsed?.version !== CACHE_VERSION || typeof parsed.records !== 'object' || parsed.records === null) {
      return { records: new Map(), version: CACHE_VERSION };
    }
    return { records: new Map(Object.entries(parsed.records)), version: CACHE_VERSION };
  } catch {
    return { records: new Map(), version: CACHE_VERSION };
  }
}

/** Persist the per-session cache; write-then-rename keeps it crash-safe. */
export function saveSessionCache(root, cache) {
  try {
    const dir = cacheDir(root);
    mkdirSync(dir, { recursive: true });
    const payload = zstdCompressSync(
      Buffer.from(
        JSON.stringify({
          version: CACHE_VERSION,
          savedAt: Date.now(),
          records: Object.fromEntries(cache.records),
        }),
        'utf8',
      ),
    );
    const temp = join(dir, `${ENTRY_FILE}.${process.pid}.tmp`);
    writeFileSync(temp, payload);
    renameSync(temp, join(dir, ENTRY_FILE));
    return true;
  } catch {
    return false;
  }
}

/**
 * A ready-to-serve report cache, kept beside the per-session entries.
 *
 * The per-session file carries the shaped events needed to *continue* a session,
 * which makes it large (~2 MB compressed) and slow enough to decompress that a
 * warm first paint still cost ~500 ms. This file holds only the finished report,
 * a few tens of KB, so the first paint after a restart is a decompress and a
 * write, nothing else.
 *
 * One file per window: the page requests two windows on open (`days=0` for the
 * heatmap, `days=30` for the main panel), and a single shared file made them
 * evict each other, so whichever came second was always a cold rebuild.
 *
 * It is never trusted on its own: the caller compares `fingerprint` against the
 * store before serving it.
 */
/** The viewer-local date, used to notice that the calendar rolled over. */
function localDayKey(offsetMinutes) {
  const shifted = Date.now() + (offsetMinutes ?? 0) * 60_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

function reportFileName(options) {
  return `report-cache-${options.rangeDays}.json.zst`;
}

export function saveReportCache(root, options, report, fingerprint) {
  try {
    const dir = cacheDir(root);
    mkdirSync(dir, { recursive: true });
    const payload = zstdCompressSync(
      Buffer.from(
        JSON.stringify({
          version: CACHE_VERSION,
          offsetMinutes: options.offsetMinutes,
          rangeDays: options.rangeDays,
          fingerprint,
          savedAt: Date.now(),
          builtOnLocalDay: localDayKey(options.offsetMinutes),
          report,
        }),
        'utf8',
      ),
    );
    const name = reportFileName(options);
    const temp = join(dir, `${name}.${process.pid}.tmp`);
    writeFileSync(temp, payload);
    renameSync(temp, join(dir, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * The cached report, when it was written for this window.
 *
 * `fingerprint` guards against serving numbers for a store that has moved on.
 * Pass `allowStale` to accept the entry regardless — the report is still the
 * right shape, only possibly a few seconds old, and the caller is expected to
 * rebuild behind the response.
 */
export function loadReportCache(root, options, fingerprint, allowStale = false) {
  try {
    const buffer = readFileSync(join(cacheDir(root), reportFileName(options)));
    const parsed = JSON.parse(zstdDecompressSync(buffer).toString('utf8'));
    if (parsed?.version !== CACHE_VERSION) return undefined;
    if (parsed.offsetMinutes !== options.offsetMinutes) return undefined;
    if (parsed.rangeDays !== options.rangeDays) return undefined;
    if (!allowStale && parsed.fingerprint !== fingerprint) return undefined;
    // A new local day always invalidates: the window slides, so yesterday's
    // answer is missing today even when no log was touched overnight.
    if (parsed.builtOnLocalDay !== localDayKey(options.offsetMinutes)) return undefined;
    if (!parsed.report || typeof parsed.report !== 'object') return undefined;
    return { report: parsed.report, savedAt: parsed.savedAt ?? 0, stale: parsed.fingerprint !== fingerprint };
  } catch {
    return undefined;
  }
}

/**
 * Look a session record up, returning it only when its logs are unchanged.
 *
 * The caller passes the digest it just computed for that session's directory.
 */
export function lookupSession(cache, sessionId, digest, offsetMinutes) {
  if (digest === undefined) return undefined;
  const entry = cache.records.get(sessionId);
  if (entry === undefined) return undefined;
  if (entry.digest !== digest) return undefined;
  if (entry.offsetMinutes !== offsetMinutes) return undefined;
  if (!entry.record || typeof entry.record !== 'object') return undefined;
  return entry.record;
}

export function storeSession(cache, sessionId, digest, offsetMinutes, record) {
  if (digest === undefined) return;
  cache.records.set(sessionId, { digest, offsetMinutes, record, savedAt: Date.now() });
}

export { findSessionDir, sessionDigest };
