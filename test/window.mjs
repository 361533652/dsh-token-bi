/**
 * The day facet must keep the exact requested window, quiet days included.
 *
 * Regression guard: deriving the axis from the cross-tab alone collapsed a
 * 30-day window onto the busy days, which made 7 and 30 look identical.
 */
import { UsageCollector } from '../lib/collector.mjs';

const collector = new UsageCollector({
  sessions: { list: () => [] },
  sessionQuery: { listSessions: async () => [], observeSession: async () => ({}) },
});

const windowOf = (days) => {
  const built = collector.buildReport([], [], 480, days);
  return { count: built.days.length, first: built.days[0]?.day, last: built.days[built.days.length - 1]?.day };
};

const seven = windowOf(7);
const thirty = windowOf(30);
console.log('7d window :', seven.count, seven.first, '->', seven.last);
console.log('30d window:', thirty.count, thirty.first, '->', thirty.last);

if (seven.count !== 7) throw new Error(`7-day window returned ${seven.count} days, expected 7`);
if (thirty.count !== 30) throw new Error(`30-day window returned ${thirty.count} days, expected 30`);
if (thirty.first === seven.first) {
  throw new Error(`30-day window starts on the same day as 7-day (${thirty.first}); quiet days were dropped`);
}
if (thirty.last !== seven.last) throw new Error('both windows should end on the same day');

console.log('window contract ok');
