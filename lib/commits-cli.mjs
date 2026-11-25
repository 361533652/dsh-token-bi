/**
 * Build the commit series in a separate process and write the cache.
 *
 * Reading a few hundred megabytes of session logs takes about a minute. That is
 * fine for a short-lived child process and catastrophic on the host's event
 * loop: a synchronous scan there stalls every other request, including opening a
 * session, and the whole app appears to hang. This script exists so the heavy
 * work can live in `node lib/commits-cli.mjs` instead of in a request.
 *
 *   node lib/commits-cli.mjs <sessionsRoot>
 */
import { buildCommitSeries } from './gitcommits.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2];
if (typeof root !== 'string' || root.length === 0) {
  console.error('usage: node lib/commits-cli.mjs <sessionsRoot>');
  process.exit(2);
}

try {
  const series = buildCommitSeries(root);
  mkdirSync(join(root, '.token-bi-cache'), { recursive: true });
  writeFileSync(join(root, '.token-bi-cache', 'commits.json'), JSON.stringify(series));
  console.log(`commits: ${series.days.length} days, ${series.repos.length} repos`);
} catch (error) {
  console.error('commit build failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}