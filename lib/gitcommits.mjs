/**
 * Commit volume from the local git repositories the agent has worked in.
 *
 * Two numbers per day, and they answer different questions:
 *   - every commit touching a repo whose author is the user, with the lines it
 *     added and removed (`git log --numstat`);
 *   - the subset of those the agent itself drove, found by matching commit
 *     subjects against the `git commit -m "..."` commands in the session logs.
 *
 * Reading the logs is the awkward part: `session.v4.jsonl.zstd` is a stack of
 * zstd frames and a plain decompress returns only the first one, so the file
 * looks almost empty. Each frame has to be split out and decoded on its own.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const LOG_NAME = /^session\.v\d+\.jsonl\.zstd$/;
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Emails that count as "the user" when reading a repo's history. */
const MINE = new Set(['gg361533652@gmail.com', 'dev@example.com', 'user@example.com']);

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

/**
 * Every (repo, subject) the agent typed as a commit, across all sessions.
 *
 * Subjects are matched exactly later, so duplicates (the same command appears in
 * the call, the result and two payload copies) collapse into one entry here.
 */
export function readAgentCommits(root) {
  const found = new Set();
  if (root === undefined || !existsSync(root)) return found;

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
        let buffer;
        try {
          buffer = readFileSync(join(sub, session.name, name));
        } catch {
          continue;
        }
        const text = decodeFrames(buffer);
        if (!text.includes('git commit')) continue;

        // The header carries the real working directory, which is the only
        // reliable repo hint when the command does not name one.
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
          found.add(`${repo}\u0000${subject}`);
        }
      }
    }
  }
  return found;
}

/** HEAD of every repo plus every session log's size, as one cheap key. */
export function commitsFingerprint(root, repos) {
  const parts = [];
  for (const repo of repos) {
    try {
      parts.push(execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
    } catch {
      parts.push('none');
    }
  }
  if (root !== undefined && existsSync(root)) {
    const walk = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (LOG_NAME.test(entry.name)) {
          try {
            const stat = statSync(path);
            parts.push(`${stat.size}:${Math.round(stat.mtimeMs)}`);
          } catch {
            // Vanished mid-walk.
          }
        }
      }
    };
    walk(root);
  }
  parts.sort();
  return createHash('sha1').update(parts.join(',')).digest('hex');
}

/** Lines added/removed and commit counts per day, split by who drove them. */
export function buildCommitSeries(root) {
  const agent = readAgentCommits(root);
  const repos = [...new Set([...agent].map((key) => key.split('\u0000')[0]))]
    .filter((repo) => existsSync(join(repo, '.git')));

  const days = new Map();
  const totals = { aiCommits: 0, humanCommits: 0, aiAdded: 0, humanAdded: 0, aiRemoved: 0, humanRemoved: 0 };
  const byRepo = [];

  for (const repo of repos) {
    const wanted = new Set();
    const prefixes = new Set();
    for (const key of agent) {
      const [at, subject] = key.split('\u0000');
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

  const series = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  return {
    generatedAt: Date.now(),
    days: series,
    totals,
    repos: byRepo.sort((a, b) => (b.aiCommits + b.humanCommits) - (a.aiCommits + a.humanCommits)),
    fingerprint: commitsFingerprint(root, repos),
  };
}

/** Cached series, rebuilt only when a repo or a log has moved on. */
export function readCommitSeries(root) {
  const file = commitCachePath(root);
  let cached = null;
  if (file !== null && existsSync(file)) {
    try {
      cached = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      cached = null;
    }
  }
  if (cached !== null && typeof cached.fingerprint === 'string') {
    // Cheap check first: is any repo ahead of what the cache describes?
    const repos = (cached.repos ?? []).map((entry) => `e:\\${entry.repo}`);
    const now = commitsFingerprint(root, repos);
    if (now === cached.fingerprint) return { ...cached, cached: true };
  }
  const fresh = buildCommitSeries(root);
  if (file !== null) {
    try {
      mkdirSync(join(root, '.token-bi-cache'), { recursive: true });
      writeFileSync(file, JSON.stringify(fresh));
    } catch {
      // A read-only store still serves the fresh answer for this request.
    }
  }
  return { ...fresh, cached: false };
}

function commitCachePath(root) {
  if (root === undefined) return null;
  return join(root, '.token-bi-cache', 'commits.json');
}