/**
 * Per-session on-disk cache.
 *
 * A whole-report snapshot proved useless in practice: the session you are
 * currently chatting in appends a message every few seconds, so the store
 * fingerprint changed constantly and every read fell back to a full fold.
 *
 * Caching each session's folded record instead means only the sessions that
 * actually moved get re-read. On a 47-session store that is one or two files
 * per read rather than all of them.
 *
 * Validity is per session, from that session's own log files (path, size,
 * mtime). No global fingerprint, so an unrelated session writing cannot
 * invalidate a quiet one.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Bump when the folded record shape or folding rules change. */
const CACHE_VERSION = 2;
const ENTRY_FILE = 'sessions-cache.json';
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
      const match = /session-([0-9a-f-]+)$/i.exec(entry.name);
      if (match !== null) {
        index.set(entry.name, path);
        index.set(match[1], path);
      }
      walk(path);
    }
  };
  walk(root);
  return index;
}

/**
 * A durable per-session record store backed by one JSON file.
 *
 * `dirFor`/`digestFor`/`lookup`/`remember` are what {@link UsageCollector}
 * calls; it never learns the on-disk layout.
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
    remember(sessionId, digest, offset, record) {
      if (digest === undefined) return;
      storeSession(cache, sessionId, digest, offset, record);
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

function cacheDir(root) {
  return join(root, '.token-bi-cache');
}

/** Load the per-session cache, tolerating anything unparseable. */
export function loadSessionCache(root) {
  try {
    const parsed = JSON.parse(readFileSync(join(cacheDir(root), ENTRY_FILE), 'utf8'));
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
    const payload = JSON.stringify({
      version: CACHE_VERSION,
      savedAt: Date.now(),
      records: Object.fromEntries(cache.records),
    });
    const temp = join(dir, `${ENTRY_FILE}.${process.pid}.tmp`);
    writeFileSync(temp, payload, 'utf8');
    renameSync(temp, join(dir, ENTRY_FILE));
    return true;
  } catch {
    return false;
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
