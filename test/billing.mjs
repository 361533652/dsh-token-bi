/**
 * Coverage guard: every billable signal in the session store must be handled by
 * the fold.
 *
 * The plugin silently dropped `web_fetch` for months, and nothing noticed until
 * the official bill disagreed with the dashboard. This test walks the real store
 * and fails when it finds a billable event type or a billed tool name that the
 * fold does not account for, so a new DSH billing surface breaks the build
 * instead of the numbers.
 *
 * It is data-driven on purpose: adding a case to `lib/usage.mjs` is the way to
 * make it pass, not editing the test.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { foldUsage } from '../lib/usage.mjs';
import { defaultSessionRoot } from './fixture.mjs';

const MAGIC = 4247762216;
const OFFSET = 480;

/**
 * Tool names DSH bills per request. Keep this list explicit: a tool that appears
 * here but is not folded fails the test, which is the point.
 */
const BILLED_TOOLS = new Set(['web_search', 'web_fetch']);

/**
 * Event types that carry billable model usage. `assistant/attempt` is handled
 * together with `assistant/message`; anything else here must have its own case.
 */
const BILLED_EVENT_TYPES = new Set([
  'assistant/message',
  'assistant/attempt',
  'web/deepseek-search-llm-request',
  'session/title-llm-request',
  'compaction/summary',
]);

function decodeLog(path) {
  const buffer = readFileSync(path);
  let text = '';
  let offset = 0;
  while (offset < buffer.length) {
    if (buffer.length - offset < 4) break;
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

const source = readFileSync(new URL('../lib/usage.mjs', import.meta.url), 'utf8');

const seenTools = new Map();
const seenUsageTypes = new Map();
let logs = 0;
let checked = 0;

for (const file of walk(defaultSessionRoot())) {
  let events;
  try {
    events = decodeLog(file);
  } catch {
    continue;
  }
  logs += 1;

  for (const event of events) {
    if (event.type === 'tool/call') {
      const name = event.data?.name;
      if (typeof name === 'string' && BILLED_TOOLS.has(name)) {
        seenTools.set(name, (seenTools.get(name) ?? 0) + 1);
      }
    }
    // Any event carrying a usage object is billable, whether or not we know it.
    if (event.data?.usage !== undefined && typeof event.data.usage === 'object') {
      seenUsageTypes.set(event.type, (seenUsageTypes.get(event.type) ?? 0) + 1);
    }
  }

  const folded = foldUsage(events, { offsetMinutes: OFFSET });
  checked += 1;
  if (!Array.isArray(folded.rows)) throw new Error('foldUsage did not return rows');
}

console.log('logs scanned:', logs, '| folded:', checked);
console.log('billed tools seen:', JSON.stringify(Object.fromEntries(seenTools)));
console.log('event types carrying usage:', JSON.stringify(Object.fromEntries(seenUsageTypes)));

const problems = [];

// 1. Every billed tool must produce a row of its own model.
const expectedToolModels = { web_search: 'tool-search', web_fetch: 'tool-fetch' };
for (const [tool, expected] of Object.entries(expectedToolModels)) {
  if (!seenTools.has(tool)) continue;
  if (!source.includes(`'${expected}'`)) {
    problems.push(`billed tool "${tool}" has no "${expected}" model in lib/usage.mjs`);
  }
}

// 2. Every event type that carries usage must be handled.
for (const type of seenUsageTypes.keys()) {
  if (!BILLED_EVENT_TYPES.has(type)) {
    problems.push(`event type "${type}" carries usage but is not in BILLED_EVENT_TYPES`);
  }
  if (!source.includes(`case '${type}'`) && type !== 'assistant/attempt') {
    problems.push(`event type "${type}" carries usage but has no case in lib/usage.mjs`);
  }
}

// 3. The fold must actually attribute the billed tools, not just know the names.
const fixtureEvents = [
  { type: 'tool/call', time: Date.parse('2026-10-27T02:00:00Z'), data: { callId: 'c1', name: 'web_search', arguments: '{"queries":["a","b"]}' } },
  { type: 'tool/call', time: Date.parse('2026-10-27T02:00:01Z'), data: { callId: 'c2', name: 'web_fetch', arguments: '{"url":"https://example.com"}' } },
  {
    type: 'compaction/summary',
    time: Date.parse('2026-10-27T02:00:02Z'),
    data: { provider: 'aggregate', model: 'deepseek-v4-1-flash', usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500, cacheWriteTokens: 0, totalTokens: 1600 } },
  },
];
const probe = foldUsage(fixtureEvents, { offsetMinutes: OFFSET });
const probeModels = new Set(probe.models.map((m) => m.model));
const probeCalls = probe.rows.filter((r) => r.apiCalls !== undefined).reduce((n, r) => n + r.apiCalls, 0);

console.log('probe rows:', probe.rows.length, '| models:', [...probeModels].join(', '), '| apiCalls:', probeCalls, '| tokens:', probe.totals.total);

if (!probeModels.has('tool-search')) problems.push('fold did not attribute web_search to tool-search');
if (!probeModels.has('tool-fetch')) problems.push('fold did not attribute web_fetch to tool-fetch');
// Billing counts requests, not query terms: one web_search with two queries plus
// one web_fetch is two billed requests, not three.
if (probeCalls !== 2) problems.push(`expected 2 billed requests (1 search + 1 fetch), got ${probeCalls}`);
if (probe.totals.total !== 1600) problems.push(`compaction usage not counted: expected 1600 tokens, got ${probe.totals.total}`);

// The query terms are still surfaced, for the tooltip.
const searchRow = probe.rows.find((r) => r.model === 'tool-search');
if (searchRow?.queries !== 2) problems.push(`web_search should report 2 query terms, got ${searchRow?.queries}`);

if (problems.length > 0) {
  console.log();
  for (const problem of problems) console.log('MISSING: ' + problem);
  throw new Error(`${problems.length} billable signal(s) are not accounted for`);
}

console.log('billing coverage ok');
