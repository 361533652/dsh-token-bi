/**
 * The finished-report cache is what makes a restart instant, so it must be
 * strictly keyed: wrong window, wrong zone, or a store that moved on all mean
 * "rebuild", never "serve something else".
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadReportCache, saveReportCache, storeFingerprint } from '../lib/cache.mjs';

const root = mkdtempSync(join(tmpdir(), 'token-bi-report-'));
const sessionDir = join(root, '2026', '10', '24', 'session-aaaaaaaa-1111-2222-3333-444444444444');
mkdirSync(sessionDir, { recursive: true });
const logPath = join(sessionDir, 'session.v4.jsonl.zstd');
writeFileSync(logPath, 'payload-one');

const options = { offsetMinutes: 480, rangeDays: 30 };
const report = { totals: { total: 999 }, sessions: [{ id: 'x' }], days: [], cells: [] };

// 1. Round-trip with a matching fingerprint.
let fingerprint = storeFingerprint(root);
saveReportCache(root, options, report, fingerprint);
const hit = loadReportCache(root, options, fingerprint);
console.log('round-trip:', hit !== undefined, 'total:', hit?.report?.totals?.total);
if (hit === undefined) throw new Error('report cache did not round-trip');
if (hit.report.totals.total !== 999) throw new Error('report cache returned a different report');

// 2. A changed store invalidates it.
writeFileSync(logPath, 'payload-one-plus-more');
const moved = storeFingerprint(root);
if (moved === fingerprint) throw new Error('storeFingerprint did not change after a log append');
if (loadReportCache(root, options, moved) !== undefined) {
  throw new Error('report cache survived a store change');
}

// 3. A different window or zone must not reuse it.
saveReportCache(root, options, report, moved);
if (loadReportCache(root, { offsetMinutes: 480, rangeDays: 7 }, moved) !== undefined) {
  throw new Error('report cache leaked across time windows');
}
if (loadReportCache(root, { offsetMinutes: -480, rangeDays: 30 }, moved) !== undefined) {
  throw new Error('report cache leaked across viewer offsets');
}

// 3b. Two windows must coexist. The page asks for days=0 (heatmap) and days=30
//     (main panel) on open; a single shared file made them evict each other and
//     whichever came second paid a full rebuild.
const allTime = { offsetMinutes: 480, rangeDays: 0 };
const allTimeReport = { totals: { total: 111 }, sessions: [], days: [{ day: '2026-10-24' }], cells: [] };
saveReportCache(root, allTime, allTimeReport, moved);
saveReportCache(root, options, report, moved);
const backAll = loadReportCache(root, allTime, moved);
const back30 = loadReportCache(root, options, moved);
console.log('two windows coexist:', backAll !== undefined && back30 !== undefined,
  '| all-time total:', backAll?.report?.totals?.total, '| 30d total:', back30?.report?.totals?.total);
if (backAll === undefined || back30 === undefined) {
  throw new Error('saving one window evicted the other');
}
if (backAll.report.totals.total !== 111 || back30.report.totals.total !== 999) {
  throw new Error('windows returned each other\u2019s report');
}

// 4. Corruption is ignored rather than thrown.
writeFileSync(join(root, '.token-bi-cache', `report-cache-${options.rangeDays}.json.zst`), 'not zstd');
if (loadReportCache(root, options, moved) !== undefined) throw new Error('corrupt report cache was trusted');

// 5. A never-written cache is simply absent.
rmSync(join(root, '.token-bi-cache'), { recursive: true, force: true });
if (loadReportCache(root, options, moved) !== undefined) throw new Error('absent report cache answered');

// 6. storeFingerprint is stable when nothing changes.
const a = storeFingerprint(root);
const b = storeFingerprint(root);
if (a !== b) throw new Error('storeFingerprint is not stable for an unchanged store');

rmSync(root, { recursive: true, force: true });
console.log('report cache contract ok');
