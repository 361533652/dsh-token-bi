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

//#region 窗口外的日期（合成数据）
/**
 * 热力图覆盖全年，7/30 天窗口只是一个可选预设 —— 两者重叠但不相等，
 * 所以日历上必然存在「窗口外、但可点」的格子。
 *
 * 曾经的做法是先把 cells 裁到窗口内再算 facets：点一个窗口外的日期，
 * 该日没有任何 cell 被留下 —— 图表归零、模型卡与工作区卡全空，
 * 看起来像「点了没反应」，实际是整个看板被清空。
 *
 * 真实账本经常不足 30 天（新装的机器尤其如此），跑不出这个场景，
 * 所以这里用合成数据把边界钉死，而不是等某台机器刚好攒够历史。
 */
const SYNTH_DAYS = 40;
const synthCells = [];
for (let i = 0; i < SYNTH_DAYS; i += 1) {
  const day = new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
  // 每天一条，模型与工作区随日切换，这样「该日有没有数据」是可判定的
  synthCells.push({
    day,
    provider: 'synth',
    model: i % 2 === 0 ? 'alpha' : 'beta',
    cwd: i % 2 === 0 ? '/w/one' : '/w/two',
    input: 100,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 100,
    calls: 0,
  });
}

const synthDayList = [...new Set(synthCells.map((c) => c.day))].sort();
const WINDOW = 30;
const synthCutoff = synthDayList.slice(-WINDOW)[0];
const outsideBusy = synthDayList.filter((d) => d < synthCutoff);
if (outsideBusy.length === 0) {
  throw new Error('合成数据没造出窗口外的日期，测试前提不成立');
}
const pick = outsideBusy[outsideBusy.length - 1];

// 修复前的口径：先裁窗口，再匹配选中日 —— 该日必然没有 cell
const clipped = synthCells.filter((c) => c.day >= synthCutoff && c.day === pick);
if (clipped.length !== 0) throw new Error('窗口外日期不应落进裁剪后的集合（测试前提不成立）');

// 修复后的口径：选中日与窗口取并集
const widened = synthCells.filter((c) => c.day === pick || c.day >= synthCutoff);
const pickedCells = widened.filter((c) => c.day === pick);
const spend = pickedCells.reduce((sum, c) => sum + c.total, 0);
const models = new Set(pickedCells.map((c) => `${c.provider}/${c.model}`));
const cwds = new Set(pickedCells.map((c) => c.cwd));

console.log(`窗口外日期 ${pick}: 消耗 ${spend}, 模型 ${[...models].join('/')}, 工作区 ${[...cwds].join(',')}`);
if (!(spend > 0)) throw new Error('窗口外日期的消耗被丢掉了，点它会得到一个全空的看板');
if (models.size === 0) throw new Error('窗口外日期没有还原出任何模型，日历点选仍然是死操作');
if (cwds.size === 0) throw new Error('窗口外日期没有还原出任何工作区');
console.log('窗口外日期链接 ok');
//#endregion
