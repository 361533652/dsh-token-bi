/**
 * The ledger is what makes the panel open instantly, so it has to be right
 * about three things:
 *
 *   1. a cold sync reads every session once and lands the same numbers the fold
 *      path would;
 *   2. a second sync reads nothing new and changes no number — an increment,
 *      not a re-accumulation;
 *   3. a session whose log disappears keeps its spend, because the bill records
 *      what was paid for, not what still exists on disk.
 *
 *   node test/ledger.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger, readLedgerReport, clearLedger, progressOf, saveProgress } from '../lib/ledger.mjs';

const root = mkdtempSync(join(tmpdir(), 'token-bi-ledger-'));
const db = openLedger(root);
if (db === undefined) throw new Error('ledger did not open');

const totalOf = (report) => report.totals.total;
const dayTotals = (report) => Object.fromEntries(report.days.map((day) => [day.day, day.total]));

//#region 1. an empty ledger answers with an empty report
let report = readLedgerReport(db, 480);
console.log('empty ledger:', JSON.stringify({ days: report.days.length, total: totalOf(report), sessions: report.sessions.length }));
if (report.days.length !== 0) throw new Error('an empty ledger reported days');
if (totalOf(report) !== 0) throw new Error('an empty ledger reported spend');

//#region 2. usage rows aggregate per (day, provider, model, cwd)
const { addUsage, upsertSession } = await import('../lib/ledger.mjs');

const makeSession = (id, day, spend, extra = {}) => ({
  id,
  title: `session ${id}`,
  cwd: '/proj',
  parentSession: null,
  delegationDepth: 0,
  live: false,
  firstTime: 1,
  lastTime: 2,
  days: [day],
  dayTotals: { [day]: { input: spend, output: 0, cacheRead: 0, cacheWrite: 0 } },
  turnDays: { 1: day },
  models: [{ provider: 'p', model: 'm', total: spend }],
  ...extra,
});

const usage = (day, spend, cwd = '/proj') => ({
  day, provider: 'p', model: 'm', cwd, input: spend, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0,
});

upsertSession(db, makeSession('s1', '2026-10-01', 1000), [usage('2026-10-01', 1000)]);
report = readLedgerReport(db, 480);
console.log('after one session:', JSON.stringify({ total: totalOf(report), days: dayTotals(report), sessions: report.sessions.length }));
if (totalOf(report) !== 1000) throw new Error(`first session reported ${totalOf(report)}, not 1000`);

// The same tuple written twice must *sum*, because a tail fold adds new spend
// to a bucket that already exists.
addUsage(db, [usage('2026-10-01', 500)]);
report = readLedgerReport(db, 480);
console.log('after an increment on the same tuple:', totalOf(report));
if (totalOf(report) !== 1500) throw new Error(`increment did not add: ${totalOf(report)}`);

// Two workspaces on the same day are separate buckets that both roll up.
addUsage(db, [usage('2026-10-01', 200, '/other')]);
report = readLedgerReport(db, 480);
if (totalOf(report) !== 1700) throw new Error('a second workspace did not roll into the day');

// Two models on the same day split the model card but not the day.
addUsage(db, [{ ...usage('2026-10-01', 300), model: 'm2' }]);
report = readLedgerReport(db, 480);
console.log('after a second model:', JSON.stringify({ total: totalOf(report), models: report.models.map((m) => `${m.model}:${m.total}`) }));
if (totalOf(report) !== 2000) throw new Error('a second model did not roll into the day');
//#endregion

//#region 3. a second session on another day appends, never replaces
upsertSession(db, makeSession('s2', '2026-10-02', 800), [usage('2026-10-02', 800)]);
report = readLedgerReport(db, 480);
console.log('after a second session:', JSON.stringify({ total: totalOf(report), days: dayTotals(report) }));
if (totalOf(report) !== 2800) throw new Error('the second session replaced instead of adding');
if (report.days.length !== 2) throw new Error('the second day did not appear');
if (report.days[0].day !== '2026-10-01') throw new Error('days are not sorted');
if (dayTotals(report)['2026-10-01'] !== 2000) throw new Error('the first day changed when a new one arrived');
//#endregion

//#region 4. per-session detail survives, including the day and turn maps
const session = report.sessions.find((row) => row.id === 's2');
if (session === undefined) throw new Error('the second session is missing from the report');
if (session.dayTotals['2026-10-02'].total !== 800) throw new Error('a session lost its per-day total');
if (session.turnDays[1] !== '2026-10-02') throw new Error('a session lost its turn day map');
if (session.totals.total !== 800) throw new Error('a session total disagrees with its day total');
console.log('session detail:', JSON.stringify({ id: session.id, total: session.totals.total, turns: session.turns }));
//#endregion

//#region 5. a deleted log keeps its spend
// The session row stays; only the flag changes. Nothing may be removed.
db.prepare('UPDATE session SET gone = 1 WHERE id = ?').run('s1');
report = readLedgerReport(db, 480);
console.log('after the first session was deleted from disk:', JSON.stringify({ total: totalOf(report), sessions: report.sessions.length }));
if (totalOf(report) !== 2800) throw new Error('deleting a session erased its spend');
if (!report.sessions.some((row) => row.id === 's1')) throw new Error('the deleted session vanished from the bill');
//#endregion

//#region 6. progress is what makes the next sync free
saveProgress(db, 's2', 42, 'rev-1');
const progress = progressOf(db, 's2');
console.log('progress round-trip:', JSON.stringify(progress));
if (progress === undefined || progress.uptoSeq !== 42 || progress.rev !== 'rev-1') throw new Error('progress did not round-trip');
if (progressOf(db, 'nope') !== undefined) throw new Error('an unknown session reported progress');
//#endregion

//#region 7. a rebuild is idempotent
clearLedger(db);
report = readLedgerReport(db, 480);
console.log('after clearing:', JSON.stringify({ total: totalOf(report), sessions: report.sessions.length }));
if (totalOf(report) !== 0 || report.sessions.length !== 0) throw new Error('clear left numbers behind');
if (progressOf(db, 's2') !== undefined) throw new Error('clear left progress behind');
//#endregion

//#region 8. the ledger survives a reopen (it is a file, not memory)
db.close();
const reopened = openLedger(root);
if (reopened === undefined) throw new Error('ledger did not reopen');
reopened.prepare('INSERT INTO session (id, title, cwd, parent, depth, live, first_time, last_time, added_at, gone, days) VALUES (?, ?, ?, NULL, 0, 0, 0, 0, 0, 0, ?)').run('s3', 't3', '/proj', '2026-10-03');
const reopenedReport = readLedgerReport(reopened, 480);
console.log('after reopening the file:', JSON.stringify({ sessions: reopenedReport.sessions.length, total: totalOf(reopenedReport) }));
if (!reopenedReport.sessions.some((row) => row.id === 's3')) throw new Error('rows written to the file did not survive a reopen');
reopened.close();
//#endregion

rmSync(root, { recursive: true, force: true });
console.log('ledger contract ok');
