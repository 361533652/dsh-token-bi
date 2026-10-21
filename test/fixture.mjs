/**
 * Build a report fixture from the real session store, so the render test uses
 * the same shapes the Host serves.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { UsageCollector } from '../lib/collector.mjs';

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

/**
 * The DSH session store for the current machine.
 *
 * `$DSH_HOME/sessions` by default, so the fixture works for anyone who runs the
 * tests against their own history; pass an explicit path to point it elsewhere.
 */
export function defaultSessionRoot() {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  return process.env.DSH_SESSIONS ?? join(home, 'sessions');
}

/** The full report the page consumes, folded from the local session store. */
export async function buildFixture(root = defaultSessionRoot()) {
  const byId = new Map();
  for (const file of walk(root)) {
    const events = decodeLog(file);
    const header = events[0];
    const version = Number(header.version ?? 0);
    const existing = byId.get(header.id);
    if (existing === undefined || version > existing.version) byId.set(header.id, { header, events, version });
  }
  const entries = [...byId.values()];
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
  return collector.collect({ offsetMinutes: -new Date().getTimezoneOffset() });
}
