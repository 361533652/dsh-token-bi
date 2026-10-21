/**
 * Exercise the Host half without a running Harness: mount `apply` on a stub
 * context that captures the registered route, then drive the handler with
 * plain request/response doubles and the real session store.
 *
 *   node test/route.mjs [sessionRoot]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { apply } from '../index.js';
import { defaultSessionRoot } from './fixture.mjs';

const MAGIC = 4247762216;

function decodeLog(path) {
  const buffer = readFileSync(path);
  let text = '';
  let offset = 0;
  while (offset < buffer.length) {
    if (buffer.length - offset < 4) break;
    if (buffer.readUInt32LE(offset) !== MAGIC) throw new Error(`invalid frame magic at ${offset}`);
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

const root = process.argv[2] ?? defaultSessionRoot();
const byId = new Map();
for (const file of walk(root)) {
  const events = decodeLog(file);
  const header = events[0];
  const version = Number(header.version ?? 0);
  const existing = byId.get(header.id);
  if (existing === undefined || version > existing.version) byId.set(header.id, { header, events, version });
}
const entries = [...byId.values()];

let route;
const ctx = {
  webServer: {
    register: (candidate) => {
      route = candidate;
      return () => {};
    },
  },
  effect: (factory) => {
    const dispose = factory();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  sessions: { list: () => [], get: () => undefined },
  sessionQuery: {
    listSessions: async () => entries.map((entry) => ({ header: entry.header, live: false, persisted: true })),
    observeSession: async (id) => {
      const entry = entries.find((candidate) => candidate.header.id === id);
      if (entry === undefined) throw new Error(`missing ${id}`);
      return { header: entry.header, events: entry.events, [Symbol.dispose]: () => {} };
    },
  },
};

apply(ctx);
console.log('route', route.kind, route.path);

/** Drive the registered handler with a minimal req/res pair. */
function call(path) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const res = {
      status: 0,
      headers: {},
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers ?? {};
      },
      end(body) {
        chunks.push(body ?? '');
        resolve({ status: this.status, headers: this.headers, body: chunks.join('') });
      },
    };
    const req = { url: path, headers: {} };
    Promise.resolve(route.handler(req, res)).catch(reject);
  });
}

const report = await call(`${route.path}/report?offset=-480`);
console.log('report status', report.status, 'bytes', report.body.length);
const parsed = JSON.parse(report.body);
console.log('sessions', parsed.totals.sessions, 'tokens', parsed.totals.total, 'days', parsed.days.length, 'errors', parsed.errors.length);
console.log('session fields', Object.keys(parsed.sessions[0]).join(','));
const target = parsed.sessions[0];
const detail = await call(`${route.path}/session?id=${encodeURIComponent(target.id)}&offset=-480`);
console.log('detail status', detail.status, 'rows', JSON.parse(detail.body).rows.length);
const missing = await call(`${route.path}/session?offset=-480`);
console.log('missing-id status', missing.status);
const unknown = await call(`${route.path}/nope`);
console.log('unknown status', unknown.status);
