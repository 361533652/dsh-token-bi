/**
 * The per-session durable cache must let a cold start skip unchanged sessions
 * without ever serving a session whose own log moved.
 *
 * Per-session rather than whole-store on purpose: the session you are chatting
 * in appends every few seconds, and a global fingerprint would invalidate
 * everything on every write.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSessionStore,
  indexSessionDirs,
  sessionDigest,
  resolveStoreRoot,
} from '../lib/cache.mjs';

const root = mkdtempSync(join(tmpdir(), 'token-bi-cache-'));
const layout = (id, day) => {
  const dir = join(root, '2026', '10', day, `session-${id}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

const quietDir = layout('11111111-1111-1111-1111-111111111111', '20');
const busyDir = layout('22222222-2222-2222-2222-222222222222', '21');
writeFileSync(join(quietDir, 'session.v4.jsonl.zstd'), 'quiet-payload');
writeFileSync(join(busyDir, 'session.v4.jsonl.zstd'), 'busy-payload');

// 1. Directory index resolves both id spellings: the bare uuid and the
//    `session-<uuid>` form that `listSessions()` actually returns.
const dirs = indexSessionDirs(root);
console.log('indexed keys:', dirs.size, '(two per directory)');
if (dirs.size !== 4) throw new Error(`index had ${dirs.size} keys, expected 4 (two dirs x two spellings)`);
if (dirs.get('11111111-1111-1111-1111-111111111111') !== quietDir) {
  throw new Error('index mapped the bare session id to the wrong directory');
}
if (dirs.get('session-11111111-1111-1111-1111-111111111111') !== quietDir) {
  throw new Error('index did not resolve the prefixed id that listSessions returns');
}

const options = { offsetMinutes: -480 };
const recordFor = (id) => ({ id, totals: { total: 42 }, rows: [] });
const quietId = 'session-11111111-1111-1111-1111-111111111111';
const busyId = 'session-22222222-2222-2222-2222-222222222222';

// 2. Round-trip through disk, using the prefixed id the Host supplies.
let store = createSessionStore(root, options);
store.remember(quietId, sessionDigest(quietDir), options.offsetMinutes, recordFor(quietId));
store.remember(busyId, sessionDigest(busyDir), options.offsetMinutes, recordFor(busyId));
store.flush();

store = createSessionStore(root, options);
const hit = store.lookup(quietId, sessionDigest(quietDir), options.offsetMinutes);
console.log('restart hit:', hit !== undefined, 'total:', hit?.totals?.total);
if (hit === undefined) throw new Error('unchanged session was not served from the cache');

// 3. The busy session writing must NOT invalidate the quiet one.
writeFileSync(join(busyDir, 'session.v4.jsonl.zstd'), 'busy-payload-grew');
const afterBusyWrite = store.lookup(quietId, sessionDigest(quietDir), options.offsetMinutes);
console.log('quiet session after other session wrote:', afterBusyWrite === undefined ? 'INVALIDATED (bad)' : 'still cached (good)');
if (afterBusyWrite === undefined) {
  throw new Error('one session writing invalidated another: the whole-store problem is back');
}
const busyAfterWrite = store.lookup(busyId, sessionDigest(busyDir), options.offsetMinutes);
if (busyAfterWrite !== undefined) throw new Error('the session that changed was still served stale');

// 4. The changed session refreshes, leaving the quiet one intact.
store.remember(busyId, sessionDigest(busyDir), options.offsetMinutes, recordFor(busyId));
store.flush();
store = createSessionStore(root, options);
if (store.lookup(busyId, sessionDigest(busyDir), options.offsetMinutes) === undefined) {
  throw new Error('refreshed session was not persisted');
}
if (store.lookup(quietId, sessionDigest(quietDir), options.offsetMinutes) === undefined) {
  throw new Error('quiet session was lost when another was refreshed');
}

// 5. Different viewer offset must not reuse a record bucketed for another zone.
if (store.lookup(quietId, sessionDigest(quietDir), 0) !== undefined) {
  throw new Error('cache leaked across viewer offsets');
}

// 6. mtime-only change still invalidates (a rewrite can keep the same size).
const future = new Date(Date.now() + 60_000);
utimesSync(join(quietDir, 'session.v4.jsonl.zstd'), future, future);
if (store.lookup(quietId, sessionDigest(quietDir), options.offsetMinutes) !== undefined) {
  throw new Error('cache ignored an mtime-only change');
}

// 7. Corrupt cache degrades to empty rather than throwing.
writeFileSync(join(root, '.token-bi-cache', 'sessions-cache.json'), '{ broken');
const recovered = createSessionStore(root, options);
if (recovered.size !== 0) throw new Error('corrupt cache was trusted');
if (recovered.lookup(quietId, sessionDigest(quietDir), options.offsetMinutes) !== undefined) {
  throw new Error('corrupt cache still answered a lookup');
}

// 8. The authoritative store root wins over the environment.
const fakeCtx = {
  get(name) {
    if (name !== 'sessionQuery') return undefined;
    return { _persistenceBinding: { service: { root: join(root, 'authoritative') } } };
  },
};
if (resolveStoreRoot(fakeCtx) !== join(root, 'authoritative')) {
  throw new Error('resolveStoreRoot ignored the persistence service root');
}

rmSync(root, { recursive: true, force: true });
console.log('cache contract ok');
