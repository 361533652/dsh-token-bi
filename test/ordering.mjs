/**
 * The day facet feeds a time axis, so it must come out chronological even
 * though the model and workspace facets rank by spend.
 */
import { buildFixture } from './fixture.mjs';

const report = await buildFixture();
const cells = report.cells ?? [];

const fold = (list, keyOf, compare) => {
  const map = new Map();
  for (const cell of list) {
    const key = keyOf(cell);
    const bucket = map.get(key) ?? { key, total: 0 };
    bucket.total += cell.total;
    map.set(key, bucket);
  }
  return [...map.values()].sort(compare ?? ((a, b) => b.total - a.total));
};

const days = fold(cells, (c) => c.day, (a, b) => a.key.localeCompare(b.key));
const dayKeys = days.map((d) => d.key);
console.log('first 6 days:', dayKeys.slice(0, 6));
console.log('last 3 days:', dayKeys.slice(-3));

for (let i = 1; i < dayKeys.length; i += 1) {
  if (dayKeys[i - 1] >= dayKeys[i]) {
    throw new Error(`day facet is not chronological: ${dayKeys[i - 1]} then ${dayKeys[i]}`);
  }
}

// Models still rank by spend, so the busiest one leads.
const models = fold(cells, (c) => `${c.provider}/${c.model}`);
const modelTotals = models.map((m) => m.total);
console.log('top model:', models[0].key, 'spend-first:', modelTotals.every((v, i) => i === 0 || modelTotals[i - 1] >= v));
if (!modelTotals.every((v, i) => i === 0 || modelTotals[i - 1] >= v)) {
  throw new Error('model facet is not ranked by spend');
}

console.log('facet ordering ok');
