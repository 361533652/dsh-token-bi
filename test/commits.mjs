import { readCommitSeries, decodeFrames, buildCommitSeries } from '../lib/gitcommits.mjs';

let failures = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};

// 1. Frame splitting: a single decompress must not be the whole story.
{
  const { zstdCompressSync } = await import('node:zlib');
  const frames = [Buffer.from('{"type":"session","cwd":"E:\\\\x"}\n'), Buffer.from('{"cmd":"git commit -m \\"a: b\\""}\n')];
  const stacked = Buffer.concat(frames.map((frame) => zstdCompressSync(frame)));
  const single = zstdCompressSync(frames[0]).length;
  check('the fixture really is multi-frame', stacked.length > single);
  const decoded = decodeFrames(stacked);
  check('decodeFrames yields every frame', decoded.includes('"type":"session"') && decoded.includes('git commit'), `${decoded.length} chars`);
}

// 2. Against the real store: the series must be internally consistent.
{
  const series = readCommitSeries('C:/Users/冬冬/.dsh/sessions');
  console.log(`\nreal store: ${series.days.length} days, ${series.repos.length} repos, cached=${series.cached}`);
  console.log(`  commits ${series.totals.aiCommits} AI / ${series.totals.humanCommits} human`);
  console.log(`  lines   +${series.totals.aiAdded} AI / +${series.totals.humanAdded} human`);

  check('there is a daily series', series.days.length > 0, `${series.days.length} days`);
  const sumAi = series.days.reduce((n, d) => n + d.aiCommits, 0);
  const sumHuman = series.days.reduce((n, d) => n + d.humanCommits, 0);
  check('daily commit counts add up to the totals',
    sumAi === series.totals.aiCommits && sumHuman === series.totals.humanCommits,
    `${sumAi}/${series.totals.aiCommits} · ${sumHuman}/${series.totals.humanCommits}`);
  const sumAddAi = series.days.reduce((n, d) => n + d.aiAdded, 0);
  check('daily added lines add up', sumAddAi === series.totals.aiAdded, `${sumAddAi} vs ${series.totals.aiAdded}`);
  check('every day carries both counters', series.days.every((d) => typeof d.aiCommits === 'number' && typeof d.humanCommits === 'number'));
  check('days are in ascending order',
    series.days.every((d, i) => i === 0 || series.days[i - 1].day < d.day));

  // The cache must agree with a fresh build.
  const fresh = buildCommitSeries('C:/Users/冬冬/.dsh/sessions');
  check('the cached answer matches a fresh build',
    fresh.totals.aiCommits === series.totals.aiCommits && fresh.totals.humanCommits === series.totals.humanCommits,
    `${fresh.totals.aiCommits}/${fresh.totals.humanCommits} vs ${series.totals.aiCommits}/${series.totals.humanCommits}`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\ncommit series ok');