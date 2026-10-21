/**
 * Offline harness: run the collector against the real session store without a
 * live Host, so the aggregation can be checked before installing anything.
 *
 *   node test/harness.mjs [sessionRoot]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { UsageCollector } from '../lib/collector.mjs';
import { defaultSessionRoot } from './fixture.mjs';

const MAGIC = 4247762216;

/** Locate complete Zstandard frames without decompressing them. */
function scanFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== MAGIC) throw new Error(`invalid frame magic at ${offset}`);
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    for (;;) {
      const header = buffer.readUIntLE(offset, 3);
      offset += 3;
      const last = (header & 1) !== 0;
      const type = (header >>> 1) & 3;
      const size = header >>> 3;
      offset += type === 1 ? 1 : size;
      if (last) break;
    }
    if (checksum) offset += 4;
    frames.push({ start, end: offset });
  }
  return frames;
}

function decodeLog(path) {
  const buffer = readFileSync(path);
  let text = '';
  for (const frame of scanFrames(buffer)) {
    text += zstdDecompressSync(buffer.subarray(frame.start, frame.end)).toString('utf8');
  }
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/session\.v\d+\.jsonl\.zstd$/.test(entry.name)) out.push(path);
  }
  return out;
}

const root = process.argv[2] ?? defaultSessionRoot();
const files = walk(root);

/** Newest format wins per session id, mirroring the backend's migration rule. */
const byId = new Map();
for (const file of files) {
  const events = decodeLog(file);
  const header = events[0];
  const version = Number(header.version ?? 0);
  const existing = byId.get(header.id);
  if (existing === undefined || version > existing.version) byId.set(header.id, { header, events, version, file });
}

const entries = [...byId.values()].map((entry) => ({
  header: {
    id: entry.header.id,
    createdAt: entry.header.createdAt,
    cwd: entry.header.cwd,
    parentSession: entry.header.parentSession,
    delegationDepth: entry.header.delegationDepth ?? 0,
    isSeeded: entry.header.isSeeded === false,
    agentPreset: entry.header.agentPreset,
  },
  events: entry.events,
}));

const ctx = {
  sessions: { list: () => [] },
  sessionQuery: {
    listSessions: async () => entries.map((entry) => ({ header: entry.header, live: false, persisted: true })),
    observeSession: async (id) => {
      const entry = entries.find((candidate) => candidate.header.id === id);
      if (entry === undefined) throw new Error(`missing ${id}`);
      return { header: entry.header, events: entry.events, [Symbol.dispose]: () => {} };
    },
  },
};

const collector = new UsageCollector(ctx);
const report = await collector.collect({ offsetMinutes: -new Date().getTimezoneOffset() });

console.log('sessions', report.totals.sessions, 'tokens', report.totals.total.toLocaleString('zh-CN'));
console.log('turns', report.totals.turns, 'steps', report.totals.steps);
console.log('days', report.days.map((day) => `${day.day}:${(day.total / 1e6).toFixed(1)}M`).join(' '));
console.log('models', report.models.map((model) => `${model.model}:${(model.total / 1e6).toFixed(1)}M`).join(' '));
console.log('hours', report.hours.length, 'cwds', report.cwds.length, 'errors', report.errors.length);
console.log('top sessions:');
for (const session of report.sessions.slice(0, 5)) {
  console.log(`  ${(session.totals.total / 1e6).toFixed(1)}M  ${session.turns}t  ${session.title}`);
}
const detail = await collector.sessionDetail(report.sessions[0].id, report.offsetMinutes);
console.log('detail rows', detail.rows.length, 'sum', detail.rows.reduce((sum, row) => sum + row.total, 0).toLocaleString('zh-CN'));
