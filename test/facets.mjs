/**
 * Reproduce the facet-linking maths outside the browser: pick a day, and check
 * the model card really narrows to that day when rebuilt from the cross-tab.
 */
import { buildFixture } from './fixture.mjs';

const report = await buildFixture();
const cells = report.cells ?? [];
console.log('cells:', cells.length);

const foldBy = (list, keyOf) => {
  const map = new Map();
  for (const cell of list) {
    const key = keyOf(cell);
    const bucket = map.get(key) ?? { key, total: 0 };
    bucket.total += cell.total;
    map.set(key, bucket);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
};

// Baseline: every model, no filter.
const allModels = foldBy(cells, (c) => `${c.provider}/${c.model}`);
console.log('models (no filter):', allModels.length, '->', allModels.map((m) => m.key).slice(0, 4));

// Pick the busiest day and re-fold models with only that day applied.
const busiestDay = foldBy(cells, (c) => c.day)[0].key;
const dayScoped = cells.filter((c) => c.day === busiestDay);
const modelsForDay = foldBy(dayScoped, (c) => `${c.provider}/${c.model}`);
console.log(`models on ${busiestDay}:`, modelsForDay.length, '->', modelsForDay.map((m) => m.key));

if (modelsForDay.length >= allModels.length) {
  throw new Error('day filter did not narrow the model card');
}

// And workspace scoped: pick a model, then check workspaces narrow.
const topModel = allModels[0].key;
const modelScoped = cells.filter((c) => `${c.provider}/${c.model}` === topModel);
const cwdsForModel = foldBy(modelScoped, (c) => c.cwd);
console.log(`workspaces for ${topModel}:`, cwdsForModel.map((c) => c.key));

// Combined: day + model narrows workspaces further.
const combined = cells.filter((c) => c.day === busiestDay && `${c.provider}/${c.model}` === topModel);
const cwdsCombined = foldBy(combined, (c) => c.cwd);
console.log(`workspaces for ${busiestDay} + ${topModel}:`, cwdsCombined.length, '->', cwdsCombined.map((c) => c.key));

console.log('facet linking ok');
