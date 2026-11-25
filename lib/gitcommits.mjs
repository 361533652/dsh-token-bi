/**
 * Commit volume from the local git repositories the agent has worked in.
 *
 * Two numbers per day, and they answer different questions:
 *   - every commit authored by the user, with the lines it added and removed
 *     (`git log --numstat`);
 *   - the subset the agent itself drove, found by matching commit subjects
 *     against the `git commit -m "..."` commands in the session logs.
 *
 * Reading the logs is the awkward part. `session.v4.jsonl.zstd` is a stack of
 * zstd frames and a plain decompress returns only the first one, so the file
 * looks almost empty; every frame has to be split out and decoded on its own.
 * That is expensive over a few hundred megabytes, so the extraction is cached
 * per log against its size and mtime — only a log that actually changed is read
 * again, and the whole store is warmed once at startup instead of in a request.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const LOG_NAME = /^session\.v\d+\.jsonl\.zstd$/;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Emails that count as "the user" when reading a repository's history. */
const MINE = new Set(['gg361533652@gmail.com', 'dev@example.com', 'user@example.com']);

const SEP = '\u0000';

/** Decode every zstd frame in a buffer and concatenate the text. */
export function decodeFrames(buffer) {
  const starts = [];
  let at = buffer.indexOf(ZSTD_MAGIC, 0);
  while (at >= 0) {
    starts.push(at);
    at = buffer.indexOf(ZSTD_MAGIC, at + 4);
  }
  if (starts.length === 0) return '';
  const parts = [];
  for (let i = 0; i < starts.length; i += 1) {
    const slice = buffer.subarray(starts[i], i + 1 < starts.length ? starts[i + 1] : buffer.length);
    try {
      parts.push(zstdDecompressSync(slice).toString('utf8'));
    } catch {
      // A frame cut short by a concurrent append; the next read will have it.
    }
  }
  return parts.join('');
}

const tidy = (text) => text
  .replace(/\\+n/g, ' ')
  .replace(/\\+$/, '')
  .replace(/\s+/g, ' ')
  .trim();

const tidyPath = (path) => path
  .replace(/\\\\/g, '\\')
  .replace(/\//g, '\\')
  .replace(/\\+$/, '')
  .toLowerCase();

/** `cd \"E:/x\"` and `git -C E:\\x` both appear, escaped by the JSON payload. */
const REPO_NEAR = /(?:cd\s+|(?:git\s+)?-C\s+)\\?"?([A-Za-z]:[^\s"']+)/g;
const COMMIT_SUBJECT = /git commit[^"']*?-m\s+\\?["']([^"']{4,200})/g;

/** Pairs typed into one session log, as `repo\0subject` strings. */
function subjectsFromLog(text) {
  const pairs = [];
  if (!text.includes('git commit')) return pairs;

  let sessionCwd = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"cwd"')) continue;
    try {
      const event = JSON.parse(line);
      if (typeof event.cwd === 'string') {
        sessionCwd = tidyPath(event.cwd);
        break;
      }
    } catch {
      // Not the header; keep looking.
    }
  }

  COMMIT_SUBJECT.lastIndex = 0;
  let match;
  while ((match = COMMIT_SUBJECT.exec(text)) !== null) {
    const subject = tidy(match[1]);
    const before = text.slice(Math.max(0, match.index - 800), match.index);
    const near = [...before.matchAll(REPO_NEAR)];
    const repo = near.length > 0 ? tidyPath(near[near.length - 1][1]) : sessionCwd;
    if (repo === null) continue;
    pairs.push(`${repo}${SEP}${subject}`);
  }
  return pairs;
}

/** Every (repo, subject) the agent typed as a commit, across all sessions. */
export function readAgentCommits(root) {
  const found = new Set();
  if (root === undefined || !existsSync(root)) return found;

  const cacheFile = join(root, '.token-bi-cache', 'commits-logs.json');
  let previous = {};
  if (existsSync(cacheFile)) {
    try {
      const parsed = JSON.parse(readFileSync(cacheFile, 'utf8'));
      if (parsed !== null && typeof parsed.logs === 'object') previous = parsed.logs;
    } catch {
      previous = {};
    }
  }

  const next = {};
  let decoded = 0;
  let reused = 0;

  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
    const sub = join(root, dir.name);
    let sessions;
    try {
      sessions = readdirSync(sub, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      let files;
      try {
        files = readdirSync(join(sub, session.name));
      } catch {
        continue;
      }
      for (const name of files) {
        if (!LOG_NAME.test(name)) continue;
        const file = join(sub, session.name, name);
        let stat;
        try {
          stat = statSync(file);
        } catch {
          continue;
        }
        const key = file.toLowerCase();
        const hit = previous[key];
        if (hit !== undefined && hit.size === stat.size && hit.mtime === Math.round(stat.mtimeMs)) {
          next[key] = hit;
          for (const pair of hit.pairs) found.add(pair);
          reused += 1;
          continue;
        }
        let buffer;
        try {
          buffer = readFileSync(file);
        } catch {
          continue;
        }
        const pairs = subjectsFromLog(decodeFrames(buffer));
        next[key] = { size: stat.size, mtime: Math.round(stat.mtimeMs), pairs };
        for (const pair of pairs) found.add(pair);
        decoded += 1;
      }
    }
  }

  if (decoded > 0) {
    try {
      mkdirSync(join(root, '.token-bi-cache'), { recursive: true });
      writeFileSync(cacheFile, JSON.stringify({ logs: next }));
    } catch {
      // A read-only store still answers from memory.
    }
  }
  if (process.env.DSH_TOKEN_BI_DEBUG === '1') {
    console.log(`[commits] decoded ${decoded} log(s), reused ${reused}`);
  }
  return found;
}

/** Lines added/removed and commit counts per day, split by who drove them. */
export function buildCommitSeries(root) {
  const agent = readAgentCommits(root);
  const repos = [...new Set([...agent].map((key) => key.split(SEP)[0]))]
    .filter((repo) => existsSync(join(repo, '.git')));

  const days = new Map();
  const totals = { aiCommits: 0, humanCommits: 0, aiAdded: 0, humanAdded: 0, aiRemoved: 0, humanRemoved: 0 };
  const byRepo = [];

  for (const repo of repos) {
    const wanted = new Set();
    const prefixes = new Set();
    for (const key of agent) {
      const [at, subject] = key.split(SEP);
      if (at !== repo) continue;
      wanted.add(subject);
      prefixes.add(subject.slice(0, 40));
    }

    let log;
    try {
      log = execFileSync('git', ['-C', repo, 'log', '--numstat', '--pretty=format:@@%ad%x09%ae%x09%s', '--date=short'], {
        encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024,
      }).trim();
    } catch {
      continue;
    }
    if (log === '') continue;

    let current = null;
    let repoAi = 0;
    let repoHuman = 0;
    for (const line of log.split('\n')) {
      if (line.startsWith('@@')) {
        const [day, email, subject] = line.slice(2).split('\t');
        const mine = MINE.has((email ?? '').trim());
        const clean = tidy(subject ?? '');
        const isAgent = wanted.has(clean) || prefixes.has(clean.slice(0, 40));
        current = mine ? { day, isAgent } : null;
        if (current === null) continue;
        if (!days.has(day)) days.set(day, { day, aiCommits: 0, humanCommits: 0, aiAdded: 0, humanAdded: 0, aiRemoved: 0, humanRemoved: 0 });
        if (isAgent) {
          totals.aiCommits += 1;
          repoAi += 1;
          days.get(day).aiCommits += 1;
        } else {
          totals.humanCommits += 1;
          repoHuman += 1;
          days.get(day).humanCommits += 1;
        }
        continue;
      }
      if (current === null || line.trim() === '') continue;
      const [added, removed] = line.split('\t');
      if (added === '-' || removed === '-') continue;
      const add = Number(added) || 0;
      const del = Number(removed) || 0;
      const slot = days.get(current.day);
      if (current.isAgent) {
        totals.aiAdded += add;
        totals.aiRemoved += del;
        slot.aiAdded += add;
        slot.aiRemoved += del;
      } else {
        totals.humanAdded += add;
        totals.humanRemoved += del;
        slot.humanAdded += add;
        slot.humanRemoved += del;
      }
    }
    byRepo.push({ repo: repo.replace(/^[a-z]:\\/, ''), aiCommits: repoAi, humanCommits: repoHuman });
  }

  return {
    generatedAt: Date.now(),
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)),
    totals,
    repos: byRepo.sort((a, b) => (b.aiCommits + b.humanCommits) - (a.aiCommits + a.humanCommits)),
  };
}

/**
 * The series, memoised in this process.
 *
 * A rebuild costs about a minute when every log has to be decoded, so the answer
 * is kept in memory and only rebuilt when asked to explicitly. Startup warms it
 * in the background, which is why opening the panel never waits for it.
 */
let memo = null;
let memoAt = 0;

export function readCommitSeries(root, { refresh = false } = {}) {
  const warm = memo !== null && Date.now() - memoAt < 10 * 60 * 1000;
  if (warm && !refresh) return { ...memo, cached: true };
  if (memo !== null && !refresh) return { ...memo, cached: true, stale: true };

  const series = buildCommitSeries(root);
  memo = series;
  memoAt = Date.now();
  try {
    mkdirSync(join(root, '.token-bi-cache'), { recursive: true });
    writeFileSync(join(root, '.token-bi-cache', 'commits.json'), JSON.stringify(series));
  } catch {
    // A read-only store still answers for this process.
  }
  return { ...series, cached: false };
}

/** Seed the in-memory copy from disk so the first request is instant. */
export function loadCommitCache(root) {
  if (root === undefined) return null;
  try {
    const parsed = JSON.parse(readFileSync(join(root, '.token-bi-cache', 'commits.json'), 'utf8'));
    if (parsed !== null && Array.isArray(parsed.days)) {
      memo = parsed;
      memoAt = 0; // treat as stale so a rebuild can still happen
      return parsed;
    }
  } catch {
    // No usable cache yet.
  }
  return null;
}