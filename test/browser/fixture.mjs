/**
 * A deterministic report fixture, shaped exactly like `collector.buildReport`.
 *
 * The drag harness needs a board that renders, and it needs the same board on
 * every run: a test that changes its own input cannot tell "the drag is broken"
 * from "today's store has no sessions". Real-store mode is still available
 * through `TBI_FIXTURE=store`, which reuses `test/fixture.mjs`, but the default
 * is synthetic on purpose.
 *
 * Card order is the thing under test; the numbers only have to be plausible.
 */

const DAY = 86_400_000;

/** `YYYY-MM-DD` for an instant, shifted by the viewer's offset. */
function dayKey(ms, offsetMinutes) {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

const EMPTY = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * Forty days of history ending today, so the default 30-day preset always has
 * a full window and the headline never renders against an empty report.
 */
export function buildSyntheticReport(now = Date.now()) {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const days = [];
  for (let i = 39; i >= 0; i -= 1) {
    const ms = now - i * DAY;
    const key = dayKey(ms, offsetMinutes);
    // Every day spends something, except one quiet day, so the "active days"
    // count is not simply the window length.
    const busy = i !== 12;
    const input = busy ? 120_000 + ((i * 7919) % 90_000) : 0;
    const output = busy ? 28_000 + ((i * 104_729) % 21_000) : 0;
    const cacheRead = busy ? 410_000 + ((i * 15_485_863) % 260_000) : 0;
    const cacheWrite = busy ? 33_000 + ((i * 324_528_001) % 9_000) : 0;
    days.push({
      day: key,
      input,
      output,
      cacheRead,
      cacheWrite,
      total: input + output + cacheRead + cacheWrite,
      calls: busy ? 40 + (i % 17) : 0,
      sessions: busy ? 1 + (i % 3) : 0,
      cost: busy ? (input + output) / 1e6 * 0.9 : 0,
    });
  }

  const models = [
    { provider: 'deepseek', model: 'deepseek-v4', input: 2_600_000, output: 620_000, cacheRead: 11_400_000, cacheWrite: 190_000 },
    { provider: 'deepseek', model: 'deepseek-v4-flash', input: 1_100_000, output: 240_000, cacheRead: 3_900_000, cacheWrite: 88_000 },
    { provider: 'aggregate', model: 'v4-1-flash', input: 240_000, output: 61_000, cacheRead: 710_000, cacheWrite: 22_000 },
  ].map((row) => ({
    ...row,
    total: row.input + row.output + row.cacheRead + row.cacheWrite,
    calls: 120,
    cost: (row.input + row.output) / 1e6 * 0.9,
    unpricedTokens: 0,
  }));

  const cwds = [
    { cwd: 'E:\\dsh\\workspace', input: 2_100_000, output: 500_000, cacheRead: 9_800_000, cacheWrite: 150_000 },
    { cwd: 'E:\\gitbub-project\\dsh-token-bi', input: 1_840_000, output: 421_000, cacheRead: 6_200_000, cacheWrite: 150_000 },
  ].map((row) => ({
    ...row,
    total: row.input + row.output + row.cacheRead + row.cacheWrite,
    calls: 90,
    cost: (row.input + row.output) / 1e6 * 0.9,
    unpricedTokens: 0,
  }));

  const totals = { ...EMPTY(), sessions: 6, live: 1, turns: 96, steps: 214, unpricedTokens: 0, cost: 4.18 };
  for (const day of days) {
    totals.input += day.input;
    totals.output += day.output;
    totals.cacheRead += day.cacheRead;
    totals.cacheWrite += day.cacheWrite;
  }
  totals.total = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;

  const sessions = [
    ['sess-0001', '卡片拖拽重排的验收方案', 'E:\\dsh\\workspace', 1],
    ['sess-0002', '让卡片能真的被拖起来', 'E:\\gitbub-project\\dsh-token-bi', 0],
    ['sess-0003', '会话账单的缓存命中率', 'E:\\gitbub-project\\dsh-token-bi', 0],
    ['sess-0004', '按模型拆分每日消耗', 'E:\\dsh\\workspace', 0],
    ['sess-0005', 'token 账单面板上线', 'E:\\gitbub-project\\dsh-token-bi', 0],
    ['sess-0006', '子代理调用树的折叠', 'E:\\dsh\\workspace', 0],
  ].map(([id, title, cwd, live], index) => {
    const day = days[days.length - 1 - index].day;
    const tokens = 180_000 + index * 91_000;
    return {
      id,
      title,
      prompt: title,
      cwd,
      parentSession: null,
      delegationDepth: 0,
      agentPreset: 'default',
      live: live === 1,
      firstTime: now - (index + 1) * DAY,
      lastTime: now - (index + 1) * DAY + 3_600_000,
      turns: 8 + index,
      steps: 20 + index * 3,
      llmMs: 60_000,
      toolMs: 12_000,
      totals: { input: tokens, output: Math.round(tokens / 4), cacheRead: Math.round(tokens * 3), cacheWrite: 12_000, total: tokens + Math.round(tokens / 4) + Math.round(tokens * 3) + 12_000 },
      models: [{ provider: 'deepseek', model: 'deepseek-v4', total: tokens }],
      days: [day],
      turnDays: Object.fromEntries(Array.from({ length: 8 + index }, (_, turn) => [turn + 1, day])),
      dayTotals: { [day]: { input: tokens, output: Math.round(tokens / 4), cacheRead: Math.round(tokens * 3), cacheWrite: 12_000, total: tokens } },
      rowCount: 12,
    };
  });

  const cells = [];
  for (const day of days.filter((row) => row.total > 0)) {
    for (const model of models) {
      for (const cwd of cwds) {
        const share = 1 / (models.length * cwds.length);
        cells.push({
          day: day.day,
          provider: model.provider,
          model: model.model,
          cwd: cwd.cwd,
          input: Math.round(day.input * share),
          output: Math.round(day.output * share),
          cacheRead: Math.round(day.cacheRead * share),
          cacheWrite: Math.round(day.cacheWrite * share),
          total: Math.round(day.total * share),
          calls: Math.round(day.calls * share),
          cost: day.cost * share,
        });
      }
    }
  }

  const hours = days.slice(-8).map((day) => ({
    hour: `${day.day}T09`,
    input: Math.round(day.input / 8),
    output: Math.round(day.output / 8),
    cacheRead: Math.round(day.cacheRead / 8),
    cacheWrite: Math.round(day.cacheWrite / 8),
    total: Math.round(day.total / 8),
    calls: Math.max(1, Math.round(day.calls / 8)),
  }));

  return {
    generatedAt: now,
    offsetMinutes,
    rangeDays: 0,
    cutoffDay: undefined,
    totals,
    sessions,
    models,
    tools: [],
    days,
    hours,
    cwds,
    cells,
    errors: [],
  };
}

/** Session detail for the drill-down, if a test ever opens a row. */
export function buildSyntheticDetail(report) {
  const session = report.sessions[0];
  const rows = Array.from({ length: 6 }, (_, index) => ({
    turn: Math.floor(index / 2) + 1,
    step: (index % 2) + 1,
    time: Date.now() - (6 - index) * 90_000,
    day: report.days[report.days.length - 1].day,
    provider: 'deepseek',
    model: 'deepseek-v4',
    input: 9_000 + index * 400,
    output: 2_100,
    cacheRead: 31_000,
    cacheWrite: 900,
    total: 43_000 + index * 400,
  }));
  return { ...session, rows, sum: rows.reduce((total, row) => total + row.total, 0) };
}
