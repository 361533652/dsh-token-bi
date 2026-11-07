/**
 * The ledger has to keep up with sessions without ever re-walking the disk.
 *
 * A new session is live from the instant it is created, so it arrives through
 * `ctx.sessions.list()` — a pure in-memory read. Once the one-time seed ran, a
 * sync never lists the store again. This proves the four transitions that
 * matter:
 *
 *   1. a live session's spend lands;
 *   2. a brand-new session lands without a disk scan;
 *   3. more turns in the same session add, never double-count;
 *   4. a session that ends (leaves the live list) keeps every row.
 *
 *   node test/ledger-live.mjs
 */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markSeeded, needsSeed, openLedger, readLedgerReport } from '../lib/ledger.mjs';
import { syncLedger } from '../lib/sync.mjs';

const root = join(tmpdir(), `token-bi-live-${process.pid}`);
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const offsetMinutes = -new Date().getTimezoneOffset();
const day = '2026-11-05';
const at = Date.parse(`${day}T10:00:00Z`);

/** A live session's events, folded in full every sync. */
function eventsOf(id, tokens) {
  return [
    { type: 'session', seq: 1, time: at, data: { id, version: 4, cwd: '/probe' } },
    { type: 'turn/start', seq: 2, time: at, data: { turn: 1 } },
    { type: 'step/start', seq: 3, time: at, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message', seq: 4, time: at,
      data: {
        turn: 1, step: 1,
        message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
        usage: { inputTokens: tokens, outputTokens: 0 },
      },
    },
    { type: 'step/end', seq: 5, time: at, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 6, time: at, data: { turn: 1 } },
  ];
}

const makeLive = (id) => {
  const state = { events: eventsOf(id, 0), seq: 6 };
  return {
    header: { id, createdAt: 1, cwd: '/probe' },
    get seq() { return state.seq; },
    snapshotEvents: () => state.events,
    append: (events, seq) => {
      state.events = [...state.events, ...events];
      state.seq = seq;
    },
  };
};

const live = [];
const ctx = {
  get(name) {
    if (name === 'sessions') return { list: () => live };
    return undefined;
  },
};

const db = openLedger(root);
if (db === undefined) throw new Error('ledger did not open');
// Pretend the one-time seed already ran: from here on, no disk listing.
markSeeded(db);
if (needsSeed(db)) throw new Error('markSeeded did not take');
if (readLedgerReport(db, offsetMinutes).totals.total !== 0) throw new Error('a seeded ledger started non-empty');

//#region 1 + 2. a live session lands, then a brand-new one does too
const a = makeLive('A');
a.append(eventsOf('A', 1000).slice(0, 4), 4);
a.append(eventsOf('A', 1000).slice(4), 6);
live.push(a);
let result = await syncLedger(ctx, db, offsetMinutes, { skipListed: true });
console.log('A live:', JSON.stringify({ total: result.report.totals.total, folded: result.folded }));
if (result.report.totals.total !== 1000) throw new Error(`A did not land: ${result.report.totals.total}`);

const b = makeLive('B');
b.append(eventsOf('B', 2000).slice(4), 6);
b.header = { id: 'B', createdAt: 1, cwd: '/probe' };
live.push({ ...b, header: { id: 'B', createdAt: 1, cwd: '/probe' }, snapshotEvents: () => eventsOf('B', 2000) });
result = await syncLedger(ctx, db, offsetMinutes, { skipListed: true });
console.log('B created:', JSON.stringify({ total: result.report.totals.total, folded: result.folded, sessions: result.report.sessions.length }));
if (result.report.totals.total !== 3000) throw new Error(`B did not land: ${result.report.totals.total}`);
if (result.folded !== 1) throw new Error(`a new session should fold exactly one, folded ${result.folded}`);
//#endregion

//#region 3. more turns add, never double-count
// A second turn worth 500, folded from the whole log again (a live session is
// always folded in full, so its per-day rows stay exact).
const turn2 = [
  { type: 'turn/start', seq: 8, time: at + 1000, data: { turn: 2 } },
  { type: 'step/start', seq: 9, time: at + 1001, data: { turn: 2, step: 1 } },
  {
    type: 'assistant/message', seq: 10, time: at + 1002,
    data: {
      turn: 2, step: 1,
      message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
      usage: { inputTokens: 500, outputTokens: 0 },
    },
  },
  { type: 'step/end', seq: 11, time: at + 1003, data: { turn: 2, step: 1 } },
  { type: 'turn/end', seq: 12, time: at + 1004, data: { turn: 2 } },
];
live[0] = {
  header: { id: 'A', createdAt: 1, cwd: '/probe' },
  seq: 12,
  snapshotEvents: () => [...eventsOf('A', 1000), ...turn2],
};
result = await syncLedger(ctx, db, offsetMinutes, { skipListed: true });
console.log('A turn 2:', JSON.stringify({ total: result.report.totals.total, folded: result.folded }));
if (result.report.totals.total !== 3500) throw new Error(`turn 2 did not add exactly once: ${result.report.totals.total}`);
const sessionA = result.report.sessions.find((row) => row.id === 'A');
const aDays = Object.keys(sessionA.dayTotals);
console.log('A day totals:', JSON.stringify(sessionA.dayTotals));
const aTotal = aDays.reduce((sum, key) => sum + sessionA.dayTotals[key].total, 0);
if (aTotal !== 1500) throw new Error(`A's per-day totals sum to ${aTotal}, not 1500`);
//#endregion

//#region 4. an ended session keeps every row
live.splice(live.findIndex((session) => session.header.id === 'B'), 1);
result = await syncLedger(ctx, db, offsetMinutes, { skipListed: true });
console.log('B ended:', JSON.stringify({ total: result.report.totals.total, sessions: result.report.sessions.length }));
if (result.report.totals.total !== 3500) throw new Error('an ended session lost its spend');
if (!result.report.sessions.some((row) => row.id === 'B')) throw new Error('an ended session vanished from the bill');
//#endregion

//#region 5. the fast path never touches the query service
let listed = 0;
ctx.get = (name) => {
  if (name === 'sessions') return { list: () => live };
  if (name === 'sessionQuery') {
    listed += 1;
    return { listSessions: async () => [] };
  }
  return undefined;
};
result = await syncLedger(ctx, db, offsetMinutes, { skipListed: true });
console.log('fast path query-service calls:', listed);
if (listed !== 0) throw new Error(`the fast path listed the store ${listed} time(s)`);
//#endregion

//#region 6. the memory counter may lie about the fold watermark
// A live session's `seq` is not the same number as "the highest seq in its events".
// A snapshot taken while the counter already ran ahead produced exactly the
// reported bug: the ledger recorded seq 2936 as folded while the log held 2973,
// so the last 3 million tokens were never counted and nothing complained.
const liars = [];
const liarCtx = {
  get(name) {
    if (name === 'sessions') return { list: () => liars };
    return undefined;
  },
};
// The session claims seq 999 but its events only reach 6.
liars.push({
  header: { id: 'L', createdAt: 1, cwd: '/probe' },
  seq: 999,
  snapshotEvents: () => eventsOf('L', 700),
});
result = await syncLedger(liarCtx, db, offsetMinutes, { skipListed: true });
const liarTotal = result.report.sessions.find((row) => row.id === 'L')?.totals?.total ?? 0;
console.log('session whose counter lies:', JSON.stringify({ total: liarTotal, folded: result.folded }));
if (liarTotal !== 700) throw new Error(`an inflated seq swallowed the session: got ${liarTotal}, want 700`);

// Now it gains a second turn. The counter is *still* 999 (it lies), but the events
// really reach 12. A watermark taken from the counter would already read 999 and
// skip this turn entirely — the exact shape of the reported 3M shortfall.
const expanded = [
  ...eventsOf('L', 700),
  { type: 'turn/start', seq: 8, time: at + 1000, data: { turn: 2 } },
  { type: 'step/start', seq: 9, time: at + 1001, data: { turn: 2, step: 1 } },
  {
    type: 'assistant/message', seq: 10, time: at + 1002,
    data: {
      turn: 2, step: 1,
      message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
      usage: { inputTokens: 300, outputTokens: 0 },
    },
  },
  { type: 'step/end', seq: 11, time: at + 1003, data: { turn: 2, step: 1 } },
  { type: 'turn/end', seq: 12, time: at + 1004, data: { turn: 2 } },
];
liars[0] = { header: { id: 'L', createdAt: 1, cwd: '/probe' }, seq: 999, snapshotEvents: () => expanded };
result = await syncLedger(liarCtx, db, offsetMinutes, { skipListed: true });
const liarTurn2 = result.report.sessions.find((row) => row.id === 'L')?.totals?.total ?? 0;
console.log('after a lying counter gained a turn:', JSON.stringify({ total: liarTurn2, folded: result.folded }));
if (liarTurn2 !== 1000) throw new Error(`the second turn was skipped: got ${liarTurn2}, want 1000`);
//#endregion

db.close();
rmSync(root, { recursive: true, force: true });
console.log('live ledger contract ok');
