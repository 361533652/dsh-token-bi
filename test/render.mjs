/**
 * Render the browser half outside a browser.
 *
 * A minimal React stand-in (createElement + the hooks the page uses) plus a
 * stubbed `fetch` renders the registered page component from real report data,
 * so chart math, table rows and the drill-down row are exercised without
 * Electron or a DOM.
 *
 *   node test/render.mjs
 */
import { readFileSync } from 'node:fs';

//#region minimal react
/**
 * Hooks are addressed per component: each function component gets its own slot
 * frame, pushed in traversal order, so nested components never share state.
 */
let frames = [];
let frameIndex = 0;
let current = null;
let dirty = false;
let effects = [];

function beginComponent() {
  const index = frameIndex;
  frameIndex += 1;
  current = frames[index] ?? (frames[index] = { slots: [], cursor: 0 });
  current.cursor = 0;
  return current;
}

function sameDeps(left, right) {
  if (left === undefined || right === undefined) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

const React = {
  createElement(type, props, ...children) {
    const flat = children.length === 0 ? props?.children : children.length === 1 ? children[0] : children;
    return { type, props: { ...(props ?? {}), children: flat } };
  },
  Fragment: Symbol('Fragment'),
  useState(initial) {
    const frame = current;
    const index = frame.cursor;
    frame.cursor += 1;
    if (!(index in frame.slots)) frame.slots[index] = typeof initial === 'function' ? initial() : initial;
    const set = (next) => {
      const value = typeof next === 'function' ? next(frame.slots[index]) : next;
      if (!Object.is(value, frame.slots[index])) {
        frame.slots[index] = value;
        dirty = true;
      }
    };
    return [frame.slots[index], set];
  },
  useMemo(factory, deps) {
    const frame = current;
    const index = frame.cursor;
    frame.cursor += 1;
    const slot = frame.slots[index];
    if (slot === undefined || !sameDeps(slot.deps, deps)) {
      frame.slots[index] = { deps, value: factory() };
    }
    return frame.slots[index].value;
  },
  useCallback(fn, deps) {
    const frame = current;
    const index = frame.cursor;
    frame.cursor += 1;
    const slot = frame.slots[index];
    if (slot === undefined || !sameDeps(slot.deps, deps)) {
      frame.slots[index] = { deps, value: fn };
    }
    return frame.slots[index].value;
  },
  useEffect(fn) {
    const frame = current;
    const index = frame.cursor;
    frame.cursor += 1;
    if (!(index in frame.slots)) {
      frame.slots[index] = true;
      effects.push(fn);
    }
  },
  // The real renderer runs this before paint; for a DOM-less walk the
  // distinction does not matter, but the API must exist.
  useLayoutEffect(fn) {
    this.useEffect(fn);
  },
  useRef(initial) {
    const frame = current;
    const index = frame.cursor;
    frame.cursor += 1;
    if (!(index in frame.slots)) frame.slots[index] = { current: initial };
    return frame.slots[index];
  },
};
//#endregion

//#region module capture
let registration;
/**
 * Every timer the page asks for, and every request it makes. The page must
 * refresh on the actions that open it and never on a tick of its own: a panel
 * left open, or sitting in the background, has to stay quiet.
 */
const timers = [];
const requests = [];
const listeners = [];
/** Stand-in for the browser's localStorage, so the paint cache is exercised. */
const storage = new Map();
const localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const window = {
  __ModuleLoader__: {
    load(candidate) {
      registration = candidate;
    },
  },
  setInterval: (fn, ms) => {
    timers.push(ms);
    return timers.length;
  },
  clearInterval: () => {},
  // The panel subscribes to focus so a background window catches up as soon as
  // it is brought forward; the stub only has to accept and remember it.
  addEventListener: (type) => {
    listeners.push(`window:${type}`);
  },
  removeEventListener: () => {},
};
/**
 * Session rows the page went looking for by id. `locateSession` is the only
 * thing that does this, so an id showing up here proves something treated a
 * click as "navigate to this session" rather than as "fold this branch".
 */
const domLookups = [];
const document = {
  visibilityState: 'visible',
  createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
  head: { appendChild() {} },
  getElementById: (id) => {
    domLookups.push(String(id));
    return null;
  },
  addEventListener: (type) => {
    listeners.push(type);
  },
  removeEventListener: () => {},
};

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
new Function('window', 'document', 'localStorage', source)(window, document, localStorage);
if (registration === undefined) throw new Error('client.js did not register a module');
const moduleExports = registration.factory((id) => {
  if (id === 'react') return React;
  throw new Error(`unexpected external ${id}`);
});
//#endregion

//#region report fixture
const { buildFixture } = await import('./fixture.mjs');
const report = await buildFixture();

// An aggregate-routed model, so the "which real channel is it on now" note can
// be asserted without depending on the local store having used the route.
report.models = [...(report.models ?? []), {
  provider: 'aggregate',
  model: 'deepseek-v4-1-flash',
  total: 500,
  input: 400,
  output: 100,
  cacheRead: 0,
  cacheWrite: 0,
}];

// A parent with a delegated child, so folding can be checked whatever the
// local session store happens to contain. Both are stamped long ago, which
// keeps them at the bottom of the table — the drill-down above clicks the first
// row, and that has to stay the real, most recent session. They are anchored on
// the newest day the fixture covers, because the page slices the report by
// window now and a session must fall inside the drawn window to appear at all.
const newestDay = report.days[report.days.length - 1].day;
const syntheticTotals = (total) => ({ input: total, output: 0, cacheRead: 0, cacheWrite: 0, total });
report.sessions.push(
  {
    id: 'fold-parent',
    title: 'Fold parent session',
    cwd: '/probe/fold',
    models: [{ provider: 'probe', model: 'fold' }],
    turns: 2,
    totals: syntheticTotals(1000),
    parentSession: null,
    live: false,
    firstTime: 1,
    lastTime: 1,
    days: [newestDay],
    turnDays: { 1: newestDay },
  },
  {
    id: 'fold-child',
    title: 'Fold child session',
    cwd: '/probe/fold',
    models: [{ provider: 'probe', model: 'fold' }],
    turns: 1,
    totals: syntheticTotals(400),
    parentSession: 'fold-parent',
    live: false,
    firstTime: 1,
    lastTime: 1,
    days: [newestDay],
    turnDays: { 1: newestDay },
  },
);

const detail = {
  ...report.sessions[0],
  rows: [
    { turn: 1, step: 1, time: Date.now() - 90_000, day: '2026-10-21', provider: 'p', model: 'm', input: 900, output: 100, cacheRead: 4000, cacheWrite: 0, total: 5000 },
    { turn: 1, step: 2, time: Date.now() - 60_000, day: '2026-10-21', provider: 'p', model: 'm', input: 400, output: 50, cacheRead: 800, cacheWrite: 0, total: 1250 },
  ],
};

globalThis.fetch = async (url) => {
  const target = String(url);
  requests.push(target);
  // Jet Hub probe: the aggregate route reports the real channel it is on.
  if (target.includes('/api/jet-hub')) {
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ result: { ok: true, value: { provider: 'qodercn' } } }),
    };
  }
  const body = target.includes('/session?') ? detail : report;
  return { ok: true, status: 200, statusText: 'OK', json: async () => body };
};
//#endregion

//#region mount
const registrations = [];
const dictionaries = {};
const ctx = {
  effect(factory) {
    const dispose = factory();
    return typeof dispose === 'function' ? dispose : () => {};
  },
  locale: {
    register(namespace, dicts) {
      dictionaries[namespace] = dicts;
      return () => {};
    },
    bind(namespace) {
      return (key) => dictionaries[namespace]?.zh?.[key] ?? key;
    },
  },
  slots: {
    inject(_name, callback) {
      callback();
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
};

moduleExports.apply(ctx);
console.log('registrations:', registrations.map((row) => `${row.options.name}:${row.options.key ?? row.options.id}`).join(', '));
const page = registrations.find((row) => row.options.name === 'main');
const icon = registrations.find((row) => row.options.name === 'sidebar.panellist');
if (page === undefined || icon === undefined) throw new Error('expected a main page and a sidebar icon');
const zh = dictionaries.tokenBi.zh;
const en = dictionaries.tokenBi.en;
console.log('dict keys:', Object.keys(zh).length, Object.keys(en).length);

const TEXT = Symbol('text');

function renderNode(node) {
  if (node === null || node === undefined || node === false || node === true) return [];
  if (typeof node === 'string' || typeof node === 'number') return [{ [TEXT]: String(node) }];
  if (Array.isArray(node)) return node.flatMap(renderNode);
  if (node.type === React.Fragment) return renderNode(node.props.children);
  if (typeof node.type === 'function') {
    beginComponent();
    return renderNode(node.type({ ...node.props }));
  }
  return [{ tag: node.type, props: node.props ?? {}, children: renderNode(node.props?.children) }];
}

const t = (key) => zh[key] ?? key;
let tree = [];
for (let pass = 0; pass < 10; pass += 1) {
  dirty = false;
  effects = [];
  frameIndex = 0;
  tree = renderNode(React.createElement(page.component, { t }));
  for (const effect of effects) effect();
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (!dirty) break;
}

// Opening the bill asks the host for the ledger, deliberately *without* the
// force flag. A forced read re-lists every session directory on disk (seconds,
// on a large store) to discover sessions that appeared or vanished; the ledger
// already folds what is live, so the ordinary read answers in milliseconds.
// The Refresh button is the one that forces a full sweep.
const firstReport = requests.find((url) => url.includes('/report?'));
console.log('first report request:', firstReport);
if (firstReport === undefined) throw new Error('opening the page issued no report request');
if (firstReport.includes('refresh=1')) {
  throw new Error(`opening the page forced a full sweep: ${firstReport}`);
}

// One request, for the whole history — and nothing else. The panel is not
// allowed to reach the host again while the user works: windows are slices of
// the report already in memory, so switching 7 / 30 / all costs no request.
const dataRequests = requests.filter((url) => url.includes('/api/dsh-token-bi/'));
console.log('data requests on mount:', dataRequests.length, '|', dataRequests.join(', '));
if (dataRequests.length !== 1) {
  throw new Error(`mount issued ${dataRequests.length} data requests; exactly one report is allowed: ${dataRequests.join(', ')}`);
}
if (requests.some((url) => url.includes('/days?'))) {
  throw new Error('the page still asks for the annual days separately; the whole report already carries them');
}
if (!firstReport.includes('days=0')) {
  throw new Error(`the report must be the whole history, so windows can be sliced locally: ${firstReport}`);
}

// Exactly one automatic rebuild: the mount. No focus or visibility listener may
// exist, because those turn ordinary interaction (clicking a filter, opening a
// row, coming back from another window) into a forced rebuild — the page then
// restarts under the pointer on every click.
const autoRefreshListeners = listeners.filter((type) => type === 'visibilitychange' || type === 'window:focus');
console.log('listeners:', listeners.join(', ') || '(none)');
if (autoRefreshListeners.length > 0) {
  throw new Error(`page still rebuilds on interaction: ${autoRefreshListeners.join(', ')}`);
}
// ...and the mount must rebuild exactly once. Two report requests on mount
// would mean a duplicate build (the effect ran twice) — the panel would show
// the spinner twice for the same open.
const reportRequests = requests.filter((url) => url.includes('/report?'));
console.log('report requests on mount:', reportRequests.length);
if (reportRequests.length !== 1) {
  throw new Error(`mount issued ${reportRequests.length} report requests; exactly one rebuild is allowed`);
}

const nodes = [];
const walk = (list) => {
  for (const node of list) {
    nodes.push(node);
    if (node.children) walk(node.children);
  }
};
walk(tree);
const text = nodes.filter((node) => node[TEXT] !== undefined).map((node) => node[TEXT]).join(' ');
const tags = new Map();
for (const node of nodes) if (node.tag !== undefined) tags.set(node.tag, (tags.get(node.tag) ?? 0) + 1);

console.log('nodes:', nodes.length);
console.log('tags:', [...tags.entries()].map(([tag, count]) => `${tag}×${count}`).join(' '));
console.log('text chars:', text.trim().length);
console.log('has total figure:', text.includes('累计 token'));
console.log('has today figure:', text.includes('今日消耗'));
console.log('has session title:', text.includes(report.sessions[0].title));
console.log('has daily legend:', text.includes('缓存读'));
console.log('rects:', tags.get('rect') ?? 0, 'polylines:', tags.get('polyline') ?? 0, 'tables:', tags.get('table') ?? 0);

// Exercise the drill-down: click the first session row and re-render with the
// per-turn detail in place.
const rows = nodes.filter((node) => node.tag === 'tr' && node.props['data-clickable'] === 'true');
console.log('clickable rows:', rows.length);
if (rows.length > 0) {
  rows[0].props.onClick();
  let turnRows = [];
  for (let pass = 0; pass < 6; pass += 1) {
    dirty = false;
    effects = [];
    frameIndex = 0;
    tree = renderNode(React.createElement(page.component, { t }));
    for (const effect of effects) effect();
    await new Promise((resolve) => setTimeout(resolve, 40));
    const drilled = [];
    const collect = (list) => {
      for (const node of list) {
        drilled.push(node);
        if (node.children) collect(node.children);
      }
    };
    collect(tree);
    turnRows = drilled.filter((node) => node.props?.className === 'tbi-turnRow');
    if (turnRows.length > 0 && !dirty) break;
  }
  console.log('turn rows after drill-down:', turnRows.length);
  if (turnRows.length === 0) throw new Error('drill-down produced no turn rows');
}

//#region folding delegated sessions
// A session that spawned subagents used to add a row per child to both lists,
// with no way to put them away. They are now folded under their parent and
// unfolded on demand — without dropping anything the page already promised:
// the headline totals, the row's own numbers and the call tree's own/children
// split all have to survive a fold.
const collectAll = (list) => {
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children) walk(node.children);
    }
  };
  walk(list);
  return out;
};
const rerender = async (wait = 40) => {
  for (let pass = 0; pass < 4; pass += 1) {
    dirty = false;
    effects = [];
    frameIndex = 0;
    tree = renderNode(React.createElement(page.component, { t }));
    for (const effect of effects) effect();
    await new Promise((resolve) => setTimeout(resolve, wait));
    if (!dirty) break;
  }
  return collectAll(tree);
};
const rowById = (nodes, id) => nodes.find((node) => node.props?.id === `session-${id}`);
const detailRowCount = (nodes) => nodes.filter((node) => node.props?.className === 'tbi-detailRow').length;

/**
 * Click a nested control the way a browser would.
 *
 * The fold control lives inside a row that is itself clickable, so a real click
 * runs the control's handler and then bubbles to the row's unless the control
 * stops it. Calling `onClick()` directly would skip that entirely and let a
 * missing `stopPropagation` pass unnoticed — which is exactly the bug that makes
 * folding a branch also fling the turn timeline open.
 */
const clickBubblingTo = (target, ancestor) => {
  const event = {
    stopped: false,
    stopPropagation() {
      this.stopped = true;
    },
    preventDefault() {},
  };
  target.props.onClick(event);
  if (!event.stopped && typeof ancestor?.props?.onClick === 'function') ancestor.props.onClick(event);
  return event;
};


let foldNodes = await rerender();
const headlineBefore = foldNodes.filter((node) => node.props?.className === 'tbi-figure').map((node) => JSON.stringify(node.children?.[0]?.[TEXT] ?? '')).join(',');

// Folded by default: the child row is simply not drawn.
console.log('child row folded by default:', rowById(foldNodes, 'fold-child') === undefined);
if (rowById(foldNodes, 'fold-child') !== undefined) {
  throw new Error('a subagent row is drawn by default; folding is not on');
}
const parentRow = rowById(foldNodes, 'fold-parent');
if (parentRow === undefined) throw new Error('the parent session row is missing');

// The fold control has to exist on the parent and carry the child count, so a
// folded branch is visible as a branch rather than as a session with no
// children.
const parentFoldButton = collectAll(parentRow.children ?? []).find((node) => node.props?.className === 'tbi-foldBtn');
if (parentFoldButton === undefined) {
  throw new Error('the parent row has no fold control, so its children are unreachable');
}
const foldLabel = parentFoldButton.children?.find((child) => child?.[TEXT] !== undefined)?.[TEXT];
console.log('fold control:', JSON.stringify(foldLabel));
if (parentFoldButton.props['aria-expanded'] !== false) {
  throw new Error('the fold control does not report the folded state');
}
// A folded branch has to say what is folded and how much of it: a bare count
// next to a title is not something a reader can act on.
if (!String(foldLabel).includes('1') || !String(foldLabel).includes(zh.subagent)) {
  throw new Error(`the fold control does not say how many subagents it hides: ${foldLabel}`);
}
if (parentFoldButton.props['aria-label'] !== `1 ${zh.subagent}`) {
  throw new Error(`the fold control is unlabelled for screen readers: ${parentFoldButton.props['aria-label']}`);
}

const detailsBefore = detailRowCount(foldNodes);
const foldEvent = clickBubblingTo(parentFoldButton, parentRow);
console.log('fold control swallowed the click:', foldEvent.stopped);
foldNodes = await rerender();
if (rowById(foldNodes, 'fold-child') === undefined) {
  throw new Error('clicking the fold control did not reveal the subagent row');
}
// Unfolding a branch must not also open the parent's turn timeline: the row and
// the fold control are separate targets.
if (detailRowCount(foldNodes) !== detailsBefore) {
  throw new Error('unfolding a branch also opened the turn timeline');
}
console.log('child row after unfold:', rowById(foldNodes, 'fold-child') !== undefined);

// The child rows are indented under the parent, not flattened into the list.
const childRow = rowById(foldNodes, 'fold-child');
const childName = collectAll(childRow.children ?? []).find((node) => node.props?.className === 'tbi-sessionName');
if (!String(childName?.props?.style?.paddingLeft ?? '').includes('22px')) {
  throw new Error('an unfolded subagent row is not indented under its parent');
}

// Folding only draws less; it must not change a single number on the page.
const headlineAfter = foldNodes.filter((node) => node.props?.className === 'tbi-figure').map((node) => JSON.stringify(node.children?.[0]?.[TEXT] ?? '')).join(',');
if (headlineAfter !== headlineBefore) {
  throw new Error(`folding changed the headline numbers: ${headlineBefore} -> ${headlineAfter}`);
}

// The call tree tracks the same branch state, and its fold pill must fold
// without navigating away (the row itself is the "locate" target).
const treePill = foldNodes.find((node) => node.props?.className === 'tbi-foldBtn' && node.props?.['data-sub'] === true);
if (treePill === undefined) throw new Error('the call tree has no fold control for a parent with children');
const parentTreeRow = foldNodes.find((node) => node.props?.className === 'tbi-treeRow' && node.props?.title === zh.locateSession && collectAll(node.children ?? []).some((leaf) => leaf?.[TEXT] === 'Fold parent session'));
if (parentTreeRow === undefined) throw new Error('the call tree did not draw the parent session');
const pillInsideParent = collectAll(parentTreeRow.children ?? []).find((node) => node.props?.className === 'tbi-foldBtn');
if (pillInsideParent === undefined) throw new Error('the tree row for the parent has no fold pill');
const lookupsBefore = domLookups.length;
const treeFoldEvent = clickBubblingTo(pillInsideParent, parentTreeRow);
if (!treeFoldEvent.stopped) {
  throw new Error('the tree fold pill lets the click reach the row, so folding also jumps to the session table');
}
if (domLookups.length !== lookupsBefore) {
  throw new Error(`folding from the call tree navigated to ${domLookups.slice(lookupsBefore).join(', ')}`);
}
const afterTreeFold = await rerender();
if (afterTreeFold.some((node) => node.props?.className === 'tbi-treeRow' && collectAll(node.children ?? []).some((leaf) => leaf?.[TEXT] === 'Fold child session'))) {
  throw new Error('folding from the call tree did not fold the branch');
}
// The tree keeps the parent's own/children split visible while folded, so the
// bar still accounts for the hidden rows.
const track = collectAll(parentTreeRow.children ?? []).find((node) => node.props?.className === 'tbi-treeTrack');
if (track === undefined) throw new Error('the folded parent lost its bar');
if (String(track.props.title).length === 0) throw new Error('the bar no longer explains own vs children');
console.log('tree fold ok');
//#endregion

//#region aggregate route note
// The aggregate provider is a virtual route; the card names the real channel
// the host reports as currently active, without pretending the merged history
// can be split. The test's Jet Hub stub answers "qodercn".
const aggRow = foldNodes.find((node) => node.props?.className === 'tbi-barRow' && collectAll(node.children ?? []).some((leaf) => String(leaf?.[TEXT]).includes('aggregate')));
if (aggRow === undefined) throw new Error('the synthetic aggregate model did not render a bar row');
const aggText = collectAll(aggRow.children ?? []).filter((leaf) => leaf?.[TEXT] !== undefined).map((leaf) => leaf[TEXT]).join(' ');
console.log('aggregate row:', JSON.stringify(aggText));
if (!aggText.includes('qodercn')) {
  throw new Error(`the aggregate row does not name its real channel: ${aggText}`);
}
// The hint only materialises on hover, through the Tooltip's show callback.
if (typeof aggRow.props.onMouseEnter !== 'function') {
  throw new Error('the aggregate row has no hover handler');
}
aggRow.props.onMouseEnter();
let aggTip = '';
for (let pass = 0; pass < 6; pass += 1) {
  dirty = false;
  effects = [];
  frameIndex = 0;
  tree = renderNode(React.createElement(page.component, { t }));
  for (const effect of effects) effect();
  const tipNodes = collectAll(tree).filter((leaf) => leaf?.[TEXT] !== undefined).map((leaf) => leaf[TEXT]).join(' ');
  aggTip = tipNodes;
  if (aggTip.includes(zh.aggregateHint) && !dirty) break;
}
if (!aggTip.includes(zh.aggregateHint)) {
  throw new Error('the aggregate row lost its explanation tooltip');
}
//#endregion

const titleNode = nodes.find((node) => node.tag === 'h1');
console.log('h1:', titleNode?.children?.[0]?.[TEXT]);

if (text.trim().length < 400) throw new Error('page rendered almost nothing');
if ((tags.get('rect') ?? 0) < 4) throw new Error('daily chart produced no bars');
// The default preset is 30 days, drawn as 30 columns for a report spanning far
// more than that. A chart that drew every day of the report would ignore the
// preset; a chart that drew fewer would drop days it was asked for.
const DEFAULT_RANGE_DAYS = 30;
const dailyColumns = nodes.filter((node) => node.props?.className === 'tbi-col');
console.log('daily columns:', dailyColumns.length, '| report days:', report.days.length);
if (dailyColumns.length !== DEFAULT_RANGE_DAYS) {
  throw new Error(`daily chart drew ${dailyColumns.length} columns; the 30-day preset expects ${DEFAULT_RANGE_DAYS}`);
}
// The table draws the sessions inside the 30-day preset. It cannot be asserted
// against `sessions[0]`: that is merely the newest session in the *whole* store,
// which may predate the window. Assert that the table has rows at all.
const clickableRows = nodes.filter((node) => node.tag === 'tr' && node.props['data-clickable'] === 'true');
console.log('clickable session rows:', clickableRows.length);
if (clickableRows.length === 0) throw new Error('session table did not render rows');
if (!text.includes(zh.columnSession)) throw new Error('session table lost its header');
if (!text.includes(zh.panel) || !text.includes(zh.heatmapTitle)) {
  throw new Error('heatmap card did not render');
}

//#region window switching is local
// The whole point of holding one all-time report: switching preset must be a
// local slice, never a request. Click each preset and assert nothing goes out.
const rangeButtons = nodes.filter((node) => node.props?.className === 'tbi-segBtn');
console.log('range buttons:', rangeButtons.length);
if (rangeButtons.length !== 3) throw new Error(`expected three presets, found ${rangeButtons.length}`);
const requestsBeforeRange = requests.length;
for (const button of rangeButtons) button.props.onClick();
const rangeNodes = await rerender();
console.log('requests added by preset switching:', requests.length - requestsBeforeRange);
if (requests.length !== requestsBeforeRange) {
  throw new Error(`switching preset issued ${requests.length - requestsBeforeRange} request(s); windows must be sliced locally`);
}
const heatmapCols = rangeNodes.filter((node) => node.props?.className === 'tbi-col').length;
console.log('daily columns after preset switching:', heatmapCols, '| all-time days:', report.days.length);
// The last preset clicked is "all", which really does draw every day in the
// report — the proof that a window is a *slice* and not a truncated view.
if (heatmapCols !== report.days.length) {
  throw new Error(`"all" drew ${heatmapCols} columns for a ${report.days.length}-day history`);
}
//#endregion

// The model/workspace labels truncate, so hovering must reveal the untruncated
// identity. A native `title` carrying only the model name was not enough: the
// provider and the share stayed unreachable.
//
// Re-walk the *current* tree: the drill-down above replaced it, and a node kept
// from the first walk closes over stale state slots.
const walkCurrent = () => {
  const out = [];
  const collect = (list) => {
    for (const node of list) {
      out.push(node);
      if (node.children) collect(node.children);
    }
  };
  collect(tree);
  return out;
};

let liveNodes = walkCurrent();
const barRow = liveNodes.find((node) => node.props?.className === 'tbi-barRow');
if (barRow === undefined) throw new Error('no bar row rendered');
if (typeof barRow.props.onMouseEnter !== 'function') {
  throw new Error('bar row has no hover handler, so truncated labels cannot be read in full');
}
for (const node of liveNodes) {
  if (node.props?.className === 'tbi-barName' && node.props.title !== undefined) {
    throw new Error('bar row fell back to a native title tooltip with incomplete text');
  }
}
barRow.props.onMouseEnter();
let tipText = '';
for (let pass = 0; pass < 6; pass += 1) {
  dirty = false;
  effects = [];
  frameIndex = 0;
  tree = renderNode(React.createElement(page.component, { t }));
  for (const effect of effects) effect();
  liveNodes = walkCurrent();
  const tip = liveNodes.find((node) => node.props?.className === 'tbi-tooltip');
  // Text lives on dedicated leaf nodes, not on the element itself.
  tipText = tip === undefined ? '' : (tip.children ?? []).map((child) => child?.[TEXT] ?? '').join('');
  if (tipText.length > 0 && !dirty) break;
}
console.log('bar tooltip:', JSON.stringify(tipText));
if (tipText.split('\n').length < 3) {
  throw new Error(`bar tooltip only has ${tipText.split('\n').length} line(s); full identity is still hidden`);
}
if (!/\d/.test(tipText.split('\n').at(-2) ?? '')) {
  throw new Error('bar tooltip omits the token count');
}

// Nothing on this page may carry a timer: a panel left open, or sitting in the
// background, has to cost nothing.
if (timers.length > 0) {
  throw new Error(`page still refreshes on its own timer: ${timers.join(', ')}ms`);
}
console.log('timers:', timers.length);

// Reopening the panel has to paint from the last report, not from a cold slate.
// The host unmounts the page on the way out and mounts it on the way back, so
// this is the *common* path: every switch away and back used to earn a fresh
// "reading session logs…" spinner for numbers one second old.
//
// Reset every piece of in-memory state a remount would drop, then walk the tree
// exactly once *without running effects* — that single frame is what the user
// sees before any request has had a chance to answer.
//
// `frames` has to go too: it is the stand-in for React's component state, and
// leaving it in place would let this check pass on the *previous* mount's
// state, which is exactly the situation an unmount destroys.
let savedKeys = [...storage.keys()];
if (!savedKeys.some((key) => key.includes('report'))) {
  throw new Error('nothing was kept for the next open; reopening would start cold again');
}
console.log('stored snapshots:', savedKeys.join(', '));

const walkOnce = (list) => {
  const out = [];
  const collect = (nodes) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children) collect(node.children);
    }
  };
  collect(list);
  return out;
};

frames = [];
frameIndex = 0;
dirty = false;
effects = [];
const firstFrame = renderNode(React.createElement(page.component, { t }));
const firstNodes = walkOnce(firstFrame);
const firstText = firstNodes.filter((node) => node[TEXT] !== undefined).map((node) => node[TEXT]).join(' ');
console.log('reopen first-frame chars:', firstText.trim().length);
if (firstText.includes(zh.loading)) {
  throw new Error('reopening the panel still shows the cold "reading logs" state');
}
if (!firstText.includes(zh.todayTokens)) {
  throw new Error(`reopening the panel painted no numbers: ${JSON.stringify(firstText.slice(0, 80))}`);
}
const firstFoot = firstNodes.find((node) => node.props?.className === 'tbi-foot');
if (firstFoot === undefined) throw new Error('reopened panel rendered no footer');
// The footer must not claim the painted numbers are current while the rebuild
// is still in flight.
if (!firstText.includes(zh.snapshotAt)) {
  throw new Error('reopened panel presented a restored snapshot as a fresh aggregation');
}
const footText = (firstFoot.children ?? []).flatMap((child) => (child?.children ?? []).map((leaf) => leaf?.[TEXT] ?? '')).join(' | ');
console.log('reopen footer:', footText);

// The frame *after* the mount effect is the one the user stares at while the
// request is out. The stub applies `setState` immediately, unlike React, so the
// rendered frames above cannot catch a status regression here — assert the
// transition rule itself instead.
//
// `load` starts a rebuild. Whatever is on screen must survive it: a page
// painted from a snapshot is in `refreshing` already, and a rule written for
// `ready` alone demotes it back to `loading`, which swaps the whole panel for a
// spinner right after the numbers appear. That is the flash-and-vanish bug this
// check exists for.
const transitions = [...readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8').matchAll(/setStatus\(\(current\) => \(([^)]*)\)\)/g)].map((m) => m[1]);
console.log('status transitions:', transitions.join(' | '));
if (transitions.length === 0) throw new Error('no status transition found; did the refresh state machine move?');
for (const transition of transitions) {
  if (transition.includes("=== 'ready'")) {
    throw new Error(`status transition "${transition}" only preserves a full panel; a snapshot-painted one is dropped back to the cold state`);
  }
}
if (!transitions.some((transition) => transition.includes("=== 'loading'"))) {
  throw new Error('status transition never treats the cold state specially, so the loading placeholder cannot render');
}

// ...and once the rebuild lands, the footer goes back to claiming the numbers
// are current. Otherwise every open would look permanently half-loaded.
savedKeys = null;
frames = [];
frameIndex = 0;
dirty = false;
effects = [];
let settledTree = renderNode(React.createElement(page.component, { t }));
for (const effect of effects) effect();
await new Promise((resolve) => setTimeout(resolve, 60));
frames = []; // drop again: the remount must start from the snapshot, not the response
frameIndex = 0;
dirty = false;
effects = [];
for (let pass = 0; pass < 6; pass += 1) {
  dirty = false;
  effects = [];
  frameIndex = 0;
  settledTree = renderNode(React.createElement(page.component, { t }));
  // Only the follow-up effects, not a fresh mount: replay what the mount
  // registered, exactly as a real open would.
  for (const effect of effects) effect();
  await new Promise((resolve) => setTimeout(resolve, 40));
  if (!dirty) break;
}
const settledNodes = walkOnce(settledTree);
const settledText = settledNodes.filter((node) => node[TEXT] !== undefined).map((node) => node[TEXT]).join(' ');
const settledFoot = settledNodes.find((node) => node.props?.className === 'tbi-foot');
const settledFootText = (settledFoot?.children ?? []).flatMap((child) => (child?.children ?? []).map((leaf) => leaf?.[TEXT] ?? '')).join(' | ');
console.log('settled footer:', settledFootText);
if (settledText.includes(zh.snapshotAt) && settledText.includes(zh.refreshing)) {
  throw new Error(`footer never returns to a settled state: ${settledFootText}`);
}

console.log('render ok');
//#endregion
