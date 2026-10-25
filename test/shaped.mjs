/**
 * If we cache only the events the fold actually consumes, how big is that, and
 * can it reproduce the full fold exactly?
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { summarizeSession } from '../lib/collector.mjs';
import { shapeEvents } from '../lib/shaped-events.mjs';
import { defaultSessionRoot } from './fixture.mjs';

const MAGIC = 4247762216;
const OFFSET = 480;

function decodeLog(path) {
  const buffer = readFileSync(path);
  let text = '';
  let offset = 0;
  while (offset < buffer.length) {
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== MAGIC) throw new Error('bad frame');
    const start = offset;
    offset += 4;
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    offset += (singleSegment ? 0 : 1) + (dictionaryFlag === 3 ? 4 : dictionaryFlag) + (contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag);
    for (;;) {
      const header = buffer.readUIntLE(offset, 3);
      offset += 3;
      const last = (header & 1) !== 0;
      const type = (header >>> 1) & 3;
      offset += type === 1 ? 1 : header >>> 3;
      if (last) break;
    }
    if (checksum) offset += 4;
    text += zstdDecompressSync(buffer.subarray(start, offset)).toString('utf8');
  }
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/session\.v\d+\.jsonl\.zstd$/.test(entry.name)) out.push(path);
  }
  return out;
}

const byId = new Map();
for (const file of walk(defaultSessionRoot())) {
  let events;
  try {
    events = decodeLog(file);
  } catch {
    continue;
  }
  const header = events[0];
  if (header?.id === undefined) continue;
  const version = Number(header.version ?? 0);
  const existing = byId.get(header.id);
  if (existing === undefined || version > existing.version) byId.set(header.id, { events, version });
}

let fullBytes = 0;
let shapedBytes = 0;
let mismatches = 0;
let compared = 0;
let titleComparisons = 0;
let titleMismatches = 0;
const titleExamples = [];
const examples = [];

for (const [id, { events }] of byId) {
  const header = {
    id,
    createdAt: typeof events[0].createdAt === 'number' ? events[0].createdAt : 0,
    cwd: typeof events[0].cwd === 'string' ? events[0].cwd : '',
    parentSession: null, delegationDepth: 0, agentPreset: null,
  };
  const full = summarizeSession(header, events, OFFSET, false);
  const shaped = shapeEvents(events);
  const rebuilt = summarizeSession(header, shaped, OFFSET, false);

  fullBytes += JSON.stringify(events).length;
  shapedBytes += JSON.stringify(shaped).length;
  compared += 1;

  const same =
    full.totals.input === rebuilt.totals.input &&
    full.totals.output === rebuilt.totals.output &&
    full.totals.cacheRead === rebuilt.totals.cacheRead &&
    full.totals.cacheWrite === rebuilt.totals.cacheWrite;

  // The fold also derives the session title; a shaping step that drops it made
  // the table fall back to "Session <id>" while the totals still matched.
  const sameTitle = (full.title ?? '') === (rebuilt.title ?? '');

  if (sameTitle) titleComparisons += 1;
  if (!sameTitle) titleMismatches += 1;

  if (!same || !sameTitle) {
    mismatches += 1;
    if (!sameTitle && titleExamples.length < 6) {
      titleExamples.push({ id: String(id).slice(0, 24), full: full.title, shaped: rebuilt.title });
    }
    if (examples.length < 4) {
      examples.push({
        id: String(id).slice(0, 22),
        full: JSON.stringify(full.totals),
        shaped: JSON.stringify(rebuilt.totals),
      });
    }
  }
}

console.log('sessions           :', compared);
console.log('mismatches         :', mismatches);
console.log('full events MB     :', (fullBytes / 1048576).toFixed(1));
console.log('shaped events MB   :', (shapedBytes / 1048576).toFixed(1));
console.log('reduction          :', ((1 - shapedBytes / fullBytes) * 100).toFixed(0) + '%');
console.log('titles compared:', titleComparisons, 'mismatched:', titleMismatches);
if (titleExamples.length > 0) console.log('title examples:', JSON.stringify(titleExamples, null, 1));
if (examples.length) console.log('examples:', JSON.stringify(examples, null, 1));
if (mismatches > 0) {
  console.log('SHAPING PARITY FAILED');
  process.exit(1);
}
if (titleMismatches > 0) {
  console.log('SHAPING DROPPED SESSION TITLES');
  process.exit(1);
}
console.log('shaping parity ok (exact fold reproduction)');
