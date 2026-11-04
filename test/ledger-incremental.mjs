/**
 * 验证增量追加：新增一个会话后，只折叠它一个，总数正确累加。
 */
import { join } from 'node:path';
import { openLedger } from '../lib/ledger.mjs';
import { syncLedger, rebuildLedger } from '../lib/sync.mjs';
import { summarizeSession } from '../lib/collector.mjs';

const root = process.env.TEMP + '/tbi-incr-probe';
import { mkdirSync, rmSync } from 'node:fs';
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const offsetMinutes = -new Date().getTimezoneOffset();

const makeEvents = (id, day, tokens) => {
  const time = Date.parse(`${day}T10:00:00Z`);
  return [
    { type: 'session', seq: 1, time, data: { id, version: 4, cwd: '/probe' } },
    { type: 'turn/start', seq: 2, time, data: { turn: 1 } },
    { type: 'step/start', seq: 3, time, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message', seq: 4, time,
      data: {
        turn: 1, step: 1,
        message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } },
        usage: { inputTokens: tokens, outputTokens: 0 },
      },
    },
    { type: 'step/end', seq: 5, time, data: { turn: 1, step: 1 } },
    { type: 'turn/end', seq: 6, time, data: { turn: 1 } },
  ];
};

const sessions = new Map();
const addSession = (id, day, tokens) => {
  sessions.set(id, { header: { id, createdAt: 1, cwd: '/probe', parentSession: null, delegationDepth: 0 }, events: makeEvents(id, day, tokens) });
};

const ctxFor = () => ({
  sessions: { list: () => [] },
  sessionQuery: {
    listSessions: async () => [...sessions.values()].map((s) => ({ header: s.header, live: false, persisted: true })),
    observeSession: async (id, options) => {
      const entry = sessions.get(id);
      if (entry === undefined) throw new Error('missing ' + id);
      const events = options?.fromSeq === undefined ? entry.events : entry.events.filter((ev) => (Number(ev.seq) || 0) >= options.fromSeq);
      return { header: entry.header, events, [Symbol.dispose]: () => {} };
    },
  },
});

const db = openLedger(root);
if (db === undefined) throw new Error('ledger did not open');

// 第一步：两个会话，全量
addSession('A', '2026-10-01', 1000);
addSession('B', '2026-10-02', 2000);
let r = await rebuildLedger(ctxFor(), db, offsetMinutes);
console.log('初始:', JSON.stringify({ total: r.report.totals.total, sessions: r.report.sessions.length, folded: r.folded }));
if (r.report.totals.total !== 3000) throw new Error(`初始总数错: ${r.report.totals.total}`);

// 第二步：新增一个会话，应只折叠它
addSession('C', '2026-10-03', 4000);
r = await syncLedger(ctxFor(), db, offsetMinutes);
console.log('新增 C 后:', JSON.stringify({ total: r.report.totals.total, sessions: r.report.sessions.length, folded: r.folded, reused: r.reused }));
if (r.report.totals.total !== 7000) throw new Error(`追加后总数错: ${r.report.totals.total}`);
if (r.folded !== 1) throw new Error(`应只折叠 1 个新会话，实际 ${r.folded}`);
if (r.reused !== 2) throw new Error(`应复用 2 个旧会话，实际 ${r.reused}`);

// 第三步：老会话追加新事件，应只折叠它的尾巴
const entry = sessions.get('A');
const more = [
  { type: 'turn/start', seq: 10, time: Date.parse('2026-10-01T11:00:00Z'), data: { turn: 2 } },
  { type: 'step/start', seq: 11, time: Date.parse('2026-10-01T11:00:01Z'), data: { turn: 2, step: 1 } },
  {
    type: 'assistant/message', seq: 12, time: Date.parse('2026-10-01T11:00:02Z'),
    data: { turn: 2, step: 1, message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } }, usage: { inputTokens: 500, outputTokens: 0 } },
  },
  { type: 'step/end', seq: 13, time: Date.parse('2026-10-01T11:00:03Z'), data: { turn: 2, step: 1 } },
  { type: 'turn/end', seq: 14, time: Date.parse('2026-10-01T11:00:04Z'), data: { turn: 2 } },
];
entry.events = [...entry.events, ...more];
r = await syncLedger(ctxFor(), db, offsetMinutes);
console.log('A 追加后:', JSON.stringify({ total: r.report.totals.total, folded: r.folded, reused: r.reused }));
if (r.report.totals.total !== 7500) throw new Error(`尾巴追加后总数错: ${r.report.totals.total}（应 7500，不能重复累加）`);
if (r.folded !== 1) throw new Error(`只应折叠 A 一个`);

// 第四步：再同步一次，应零折叠
r = await syncLedger(ctxFor(), db, offsetMinutes);
console.log('静置后:', JSON.stringify({ total: r.report.totals.total, folded: r.folded, reused: r.reused }));
if (r.folded !== 0) throw new Error(`静置后不应折叠，实际 ${r.folded}`);
if (r.report.totals.total !== 7500) throw new Error('静置后数字变了');

// 第五步：删掉一个会话，数字必须保留
sessions.delete('B');
r = await syncLedger(ctxFor(), db, offsetMinutes);
console.log('删掉 B 后:', JSON.stringify({ total: r.report.totals.total, sessions: r.report.sessions.length }));
if (r.report.totals.total !== 7500) throw new Error(`删除会话丢了花费: ${r.report.totals.total}`);
const gone = db.prepare('SELECT gone FROM session WHERE id = ?').get('B');
if (Number(gone?.gone) !== 1) throw new Error('已删除会话没有标记 gone');

db.close();
rmSync(root, { recursive: true, force: true });
console.log('增量追加契约 ok');
