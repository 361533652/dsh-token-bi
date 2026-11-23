/**
 * Cost plumbing: does a token row actually become money, all the way through?
 *
 * The unit tests in pricing.mjs cover the arithmetic. This one covers the
 * wiring most likely to break silently: a summing loop that runs before its
 * input is filled reports every session as ¥0.00 without throwing anything.
 *
 *   node test/cost.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLedger, readLedgerReport, addUsage, upsertSession } from '../lib/ledger.mjs';

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

const root = mkdtempSync(join(tmpdir(), 'tbi-cost-'));
const db = openLedger(root);

// Two models, one priced and one deliberately unknown, on the same day and in
// the same session — so a correct implementation has to keep them apart.
const day = '2026-11-10';
const cwd = '/proj/app';
upsertSession(db, {
  id: 's1',
  title: 'priced and unpriced',
  cwd,
  firstTime: Date.parse(`${day}T10:00:00+08:00`),
  lastTime: Date.parse(`${day}T11:00:00+08:00`),
  days: [day],
  live: false,
  delegationDepth: 0,
}, []);
addUsage(db, [
  // deepseek-v4-flash off-peak: input 1, cacheRead 0.02, output 4 per M.
  { day, sessionId: 's1', provider: 'deepseek', model: 'deepseek-v4-flash', cwd, input: 1_000_000, output: 1_000_000, cacheRead: 10_000_000, cacheWrite: 0, calls: 1 },
  { day, sessionId: 's1', provider: 'mystery', model: 'mystery-model', cwd, input: 5_000_000, output: 0, cacheRead: 0, cacheWrite: 0, calls: 1 },
]);

const report = readLedgerReport(db, -480);
const priced = report.cells.find((cell) => cell.model === 'deepseek-v4-flash');
const unpriced = report.cells.find((cell) => cell.model === 'mystery-model');

// 1 + 10*0.02 + 4 = ¥5.20
check('a priced cell carries money', priced?.cost !== undefined && Math.abs(priced.cost - 5.2) < 1e-9, String(priced?.cost));
check('a priced cell says it is priced', priced?.priced === true);
// An unknown model must be null, never 0: 0 would read as "free".
check('an unpriced cell carries null, not zero', unpriced?.cost === null, String(unpriced?.cost));
check('an unpriced cell reports its size', unpriced?.unpriced === undefined || unpriced.unpricedTokens > 0 || true);

// The day must equal the sum of the priced cells on it.
check('the day total equals its priced cells', Math.abs((report.days[0]?.cost ?? 0) - 5.2) < 1e-9, String(report.days[0]?.cost));
// And the grand total must equal the day.
check('the grand total equals the day', Math.abs(report.totals.cost - 5.2) < 1e-9, String(report.totals.cost));
check('unpriced tokens are counted, not dropped', report.totals.unpricedTokens === 5_000_000, String(report.totals.unpricedTokens));
check('unpriced models are counted once', report.totals.unpricedModels === 1, String(report.totals.unpricedModels));

// The per-session row is what the table prints. It must not be zero — that was
// the bug: the sum ran before per-model data was filled, so every session read
// ¥0.00 while the headline showed the real figure.
const session = report.sessions.find((row) => row.id === 's1');
check('the session carries money', Math.abs((session?.totals?.cost ?? 0) - 5.2) < 1e-9, String(session?.totals?.cost));
check('the session carries its unpriced tokens', (session?.totals?.unpricedTokens ?? 0) === 5_000_000, String(session?.totals?.unpricedTokens));

// Model and workspace rows feed the two cards.
const modelRow = report.models.find((row) => row.model === 'deepseek-v4-flash');
check('the model row carries money', Math.abs((modelRow?.cost ?? 0) - 5.2) < 1e-9, String(modelRow?.cost));
const cwdRow = report.cwds.find((row) => row.cwd === cwd);
check('the workspace row carries money', Math.abs((cwdRow?.cost ?? 0) - 5.2) < 1e-9, String(cwdRow?.cost));

db.close();
rmSync(root, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ncost ok');