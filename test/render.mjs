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
const dwellTimers = [];
// Shorten the tooltip's dwell window: the test still exercises the timer, it
// just does not wait a full second per column.
// Long enough that a single render pass cannot outwait it (each pass sleeps
// ~40 ms), short enough that the suite stays fast.
globalThis.__tbiDwellMs = 200;
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
  // The column tooltip waits for the pointer to rest before showing, so the page
  // needs a real timer. It is deliberately *not* pushed into `timers`: that list
  // exists to prove no passive polling is running, and a dwell timer is an
  // interaction, not a poll.
  setTimeout: (fn, ms) => { dwellTimers.push(ms); return setTimeout(fn, ms); },
  clearTimeout: (handle) => clearTimeout(handle),
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


// The session table now pages ten rows at a time, so a check that walks every
// row has to ask for the largest page first. Setting it through the control is
// also the only way to prove the control itself works.
const pageSizeSelect = nodes.find((node) => node.props?.className === 'tbi-pagerSize');
if (pageSizeSelect !== undefined) {
  console.log('pager sizes:', JSON.stringify((pageSizeSelect.children ?? []).map((child) => child?.props?.value)));
  pageSizeSelect.props.onChange({ target: { value: '100' } });
} else {
  console.log('pager hidden: the fixture fits on one page');
}

/**
 * Every row across every page.
 *
 * The table is paged, so walking the visible rows only ever sees one page. This
 * clicks through the pager and unions the ids, which is also the check that
 * paging reaches the last row.
 */
const allRowsAcrossPages = async () => {
  const seen = new Map();
  for (let guard = 0; guard < 60; guard += 1) {
    const nodesNow = await rerender();
    for (const node of nodesNow) {
      if (node.tag === 'tr' && node.props?.['data-clickable'] === 'true') {
        seen.set(node.props.id, node);
      }
    }
    const pager = nodesNow.filter((node) => node.props?.className === 'tbi-pagerBtn');
    const next = pager[pager.length - 1];
    if (next === undefined || next.props.disabled === true) break;
    next.props.onClick();
  }
  return seen;
};

let foldNodes = await rerender();
const headlineBefore = foldNodes.filter((node) => node.props?.className === 'tbi-figure').map((node) => JSON.stringify(node.children?.[0]?.[TEXT] ?? '')).join(',');

// Folded by default: the child row is simply not drawn.
console.log('child row folded by default:', rowById(foldNodes, 'fold-child') === undefined);
if (rowById(foldNodes, 'fold-child') !== undefined) {
  throw new Error('a subagent row is drawn by default; folding is not on');
}
const parentRow = (await allRowsAcrossPages()).get('session-fold-parent');
if (parentRow === undefined) throw new Error('the parent session row is missing from every page');

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

// Unfolding a branch must not also open the parent's turn timeline: the row and
// the fold control are separate targets. Counted on the page that holds the
// parent, since paging means "the table" is no longer a single screenful.
const detailsBefore = detailRowCount(await rerender());
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

//#region the chart stacks by model, and clicking a legend name isolates one
// Stacking by cost bucket answered "what kind of spend"; the question a bill
// raises is "whose spend". Assert the column is split by model: a busy day must
// carry more than one coloured slice when the data has more than one model.
const stackedSlices = nodes.filter((node) => node.tag === 'rect' && typeof node.props?.fill === 'string' && node.props.fill.includes('color-mix'));
console.log('model-coloured slices:', stackedSlices.length);
if (stackedSlices.length === 0) throw new Error('the daily chart is not stacked by model');
// The legend is swatches only now: names would push a dozen models onto three
// lines. Identity arrives on hover, so each swatch must carry its label for
// both the pointer and assistive tech.
const legendButtons = nodes.filter((node) => node.props?.className === 'tbi-swatchBtn');
console.log('model legend swatches:', legendButtons.length);
if (legendButtons.length < 2) throw new Error('the model legend did not render');
const labelled = legendButtons.filter((node) => String(node.props?.['aria-label'] ?? '').includes('/'));
if (labelled.length !== legendButtons.length) {
  throw new Error(`only ${labelled.length} of ${legendButtons.length} swatches name their model`);
}
const hoverable = legendButtons.filter((node) => typeof node.props?.onMouseEnter === 'function');
if (hoverable.length !== legendButtons.length) {
  throw new Error('a swatch cannot be identified: it has no hover handler');
}

// Hovering a slice must isolate its model: every other slice in the chart fades.
// The slice has to be the thing under the pointer, so the hit band must sit
// *under* the bars — drawn on top it swallows the event and hover focus never
// fires. This asserts both the handler's existence and its effect.
const hoverableSlice = nodes
  .filter((node) => node.tag === 'rect' && typeof node.props?.onMouseEnter === 'function')
  .find((node) => typeof node.props?.['data-model'] === 'string');
if (hoverableSlice === undefined) throw new Error('no model slice accepts a pointer; the hit band is covering it');
const hoveredModel = hoverableSlice.props['data-model'];
hoverableSlice.props.onMouseEnter();
const afterHover = await rerender();
const slicesOf = (key) => afterHover.filter((node) => node.tag === 'rect' && node.props?.['data-model'] === key);
const sameSeries = slicesOf(hoveredModel);
const others = afterHover.filter(
  (node) => node.tag === 'rect'
    && typeof node.props?.['data-model'] === 'string'
    && node.props['data-model'] !== hoveredModel,
);
const dimmedOthers = others.filter((node) => Number(node.props?.style?.opacity ?? 1) < 0.5);
console.log('slices of the hovered model:', sameSeries.length, '| other slices dimmed:', `${dimmedOthers.length}/${others.length}`);
if (others.length === 0) throw new Error('the fixture has only one model, so focus cannot be observed');
if (dimmedOthers.length === 0) throw new Error('hovering a slice did not dim the other models');
if (dimmedOthers.length !== others.length) {
  throw new Error(`only ${dimmedOthers.length} of ${others.length} other slices were dimmed`);
}
if (sameSeries.some((node) => Number(node.props?.style?.opacity ?? 1) < 0.5)) {
  throw new Error('the hovered model was dimmed along with the others');
}

//#region the model card and the chart share one focus
// Clicking a row in the model card is a real filter, and the stacked chart has
// to follow it: the row the reader just picked is the series they are looking
// at, so the other slices must dim exactly as they do on hover. The two used to
// keep separate state and drift apart.
const modelRow = nodes.find((node) => node.props?.className === 'tbi-barRow' && typeof node.props?.onClick === 'function');
if (modelRow === undefined) throw new Error('the model card rendered no clickable rows');
const figBeforeFilter = (() => {
  const fig = nodes.find((n) => n.props?.className === 'tbi-figure');
  return (fig?.children ?? []).map((c) => c?.[TEXT] ?? (c?.children ?? []).map((g) => g?.[TEXT] ?? '').join('')).join('');
})();
modelRow.props.onClick();
const afterFilter = await rerender();
const focusedAfter = afterFilter.filter(
  (node) => node.tag === 'rect'
    && typeof node.props?.['data-model'] === 'string'
    && Number(node.props?.style?.opacity ?? 1) >= 0.5,
);
const dimAfter = afterFilter.filter(
  (node) => node.tag === 'rect'
    && typeof node.props?.['data-model'] === 'string'
    && Number(node.props?.style?.opacity ?? 1) < 0.5,
);
console.log('after filtering by a model card row: kept', focusedAfter.length, 'dimmed', dimAfter.length);
if (focusedAfter.length === 0) throw new Error('the chart shows no series after filtering, so nothing is focused');
// A filter narrows the data, so the only slices left are the selected model's;
// there may be nothing to dim. What must hold is that the chart did not error
// out and still renders slices for the chosen model.
const chosen = focusedAfter[0]?.props?.['data-model'];
if (chosen === undefined) throw new Error('the chart lost its series identity after filtering');
console.log('chart focused on:', chosen);
// The filter must also narrow the headline, or the chart and the cards would
// be describing two different things.
const figNow = afterFilter.find((n) => n.props?.className === 'tbi-figure');
const headlineNow = (figNow?.children ?? []).map((c) => c?.[TEXT] ?? (c?.children ?? []).map((g) => g?.[TEXT] ?? '').join('')).join('');
console.log('headline while filtered:', JSON.stringify(headlineNow));
// The headline must narrow with the model filter. Its `totals` memo used to
// omit `facets` from its dependency list, so the cards stayed on the all-model
// figures while every chart below had already narrowed to one model.
const headlineUnfiltered = figBeforeFilter === undefined ? '' : figBeforeFilter;
if (headlineNow === headlineUnfiltered) {
  throw new Error(`the headline ignored the model filter: ${headlineNow}`);
}
// The link has to work the other way too: pinning a model in the chart's
// legend must light up that model's row in the model card. Before this the
// two lists kept their own idea of "focused" and only one direction worked.
// Clear any model filter left by the earlier checks: a lingering selection
// would light a row for the wrong reason and make this check vacuous.
const clearModelTag = (await rerender()).find((node) => node.props?.className === 'tbi-filterTagClose');
if (clearModelTag !== undefined) { clearModelTag.props.onClick(); await rerender(); }
const beforePin = (await rerender()).filter((node) => node.props?.className === 'tbi-barRow' && node.props['data-selected'] === true);
if (beforePin.length !== 0) throw new Error('a row is lit before any pin, so this check cannot tell what lit it');
const swatch = nodes.find((node) => node.props?.className === 'tbi-swatchBtn');
if (swatch === undefined) throw new Error('no legend swatch to pin');
const pinnedKey = swatch.props['aria-label'];
swatch.props.onClick();
const afterPin = await rerender();
const litRows = afterPin.filter((node) => node.props?.className === 'tbi-barRow' && node.props['data-selected'] === true);
console.log('rows lit by the legend pin:', litRows.length, 'expected model:', pinnedKey);
if (litRows.length === 0) throw new Error('pinning a legend swatch did not light the model card row');
//#endregion
//#endregion

//#region a selected day moves the headline numbers
// Clicking a day used to leave the cards frozen on the whole window, which read
// as "my click did nothing at all". The cumulative figure must shrink to a day.
const figuresOf = (list) => list.filter((node) => node.props?.className === 'tbi-figure');
const totalBefore = figuresOf(nodes)[0];
const textOf = (node) => (node.children ?? []).map((child) => child?.[TEXT] ?? child?.children?.[0]?.[TEXT] ?? '').join('');
// Pick a column that has spend: the leftmost days of a window are often quiet,
// and selecting one of those would legitimately zero the headline.
const busyColumn = nodes
  .filter((node) => node.props?.className === 'tbi-col')
  .find((node) => collectAll(node.children ?? []).some((child) => child?.tag === 'rect' && String(child.props?.fill ?? '').includes('color-mix')));
if (busyColumn === undefined) throw new Error('no day column with spend to click');
busyColumn.props.onClick();
const afterSelect = await rerender();
const totalAfter = figuresOf(afterSelect)[0];
console.log('headline before select:', JSON.stringify(textOf(totalBefore)));
console.log('headline after select :', JSON.stringify(textOf(totalAfter)));
if (textOf(totalBefore) === textOf(totalAfter)) {
  throw new Error('selecting a day left the headline figures unchanged');
}
console.log('selected label is the day', zh.dayTokens === undefined ? '' : `(${zh.dayTokens})`);
// Clear the selection so the rest of the walk sees the full table.
const clearTag = afterSelect.find((node) => node.props?.className === 'tbi-filterTagClose');
if (clearTag !== undefined) clearTag.props.onClick();
await rerender();
//#endregion

if (!text.includes(zh.panel) || !text.includes(zh.heatmapTitle)) {
  throw new Error('heatmap card did not render');
}

// The workspace card lists every workspace in the drawn window, exactly like the
// model card does. It used to stop at eight and fold the rest into a one-line
// note, which hid real spend behind a number the reader could not act on.
// Both cards roll up behind the same component, so find them by that class and
// take the one holding workspace rows.
const rollCards = nodes.filter((node) => node.props?.className === 'tbi-roll');
console.log('scroll cards:', rollCards.length);
if (rollCards.length !== 2) throw new Error(`expected two rolling lists, found ${rollCards.length}`);
// Workspace rows are the ones whose tooltip names a path; model rows never do.
// A workspace row renders its last two path segments, so it always contains a
// separator; a model row never does.
const looksLikePath = (node) => collectAll(node.children ?? []).some((leaf) => {
  const value = leaf?.[TEXT];
  return typeof value === 'string' && (value.includes('/') || value.includes('\\'));
});
const cwdList = rollCards.find((node) => collectAll(node.children ?? []).some(
  (child) => child.props?.className === 'tbi-barRow' && looksLikePath(child),
));
if (cwdList === undefined) throw new Error('neither rolling list holds workspace rows');
const cwdRows = collectAll(cwdList.children ?? []).filter((node) => node.props?.className === 'tbi-barRow');
// The card draws the window, not the whole store, so compare against the
// workspaces that actually have spend inside the 30-day preset.
const drawnDays = new Set(dailyColumns.map((node) => node.children?.[0]?.props?.key ?? node.props?.key).filter(Boolean));
const windowDays = drawnDays.size > 0
  ? drawnDays
  : new Set(report.days.slice(-DEFAULT_RANGE_DAYS).map((day) => day.day));
const cwdsInWindow = new Set(
  report.cells.filter((cell) => windowDays.has(cell.day)).map((cell) => cell.cwd),
);
console.log('workspace rows:', cwdRows.length, '| distinct in window:', cwdsInWindow.size);
if (cwdsInWindow.size > 8 && cwdRows.length <= 8) {
  throw new Error(`the workspace card still caps at 8 rows (${cwdsInWindow.size} workspaces in the window)`);
}
if (cwdRows.length !== cwdsInWindow.size) {
  throw new Error(`the workspace card drew ${cwdRows.length} rows for ${cwdsInWindow.size} workspaces in the window`);
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

//#region the model and workspace cards roll up
// Both lists sit at ten rows and unroll under the pointer. The height animates
// to a measured value, so a longer list unrolls further and the cards below are
// pushed down smoothly rather than jumped.
for (const card of rollCards) {
  const folds = card.props['data-folds'];
  const open = card.props['data-open'];
  const rowsIn = collectAll(card.children ?? []).filter((node) => node.props?.className === 'tbi-barRow').length;
  console.log('rolling card:', JSON.stringify({ rows: rowsIn, folds, open }));
  if (rowsIn > 10 && folds !== true) {
    throw new Error(`a ${rowsIn}-row list does not roll up`);
  }
  if (rowsIn <= 10 && folds === true) {
    throw new Error(`a ${rowsIn}-row list rolls up with nothing to hide`);
  }
  if (folds === true) {
    // Hovering opens it; leaving closes it again.
    if (typeof card.props.onMouseEnter !== 'function') {
      throw new Error('a rolling list cannot be opened: it has no hover handler');
    }
    const handler = card.props.onMouseEnter;
    if (open === true) throw new Error('a rolling list started open');
  }
}
// Hover opens, leaving closes.
const firstRoll = rollCards[0];
firstRoll.props.onMouseEnter();
const opened = await rerender();
const openedRoll = opened.find((node) => node.props?.className === 'tbi-roll');
console.log('after hover:', JSON.stringify({ open: openedRoll?.props['data-open'] }));
if (openedRoll?.props['data-open'] !== true) {
  throw new Error('hovering a rolling list did not open it');
}
openedRoll.props.onMouseLeave();
const closed = await rerender();
const closedRoll = closed.find((node) => node.props?.className === 'tbi-roll');
if (closedRoll?.props['data-open'] !== false) {
  throw new Error('leaving a rolling list did not fold it back');
}
// A selected row pins the list open: folding away the row the user just clicked
// would hide what they are reading.
const modelRoll = closed.find((node) => node.props?.className === 'tbi-roll');
const modelRowToPin = collectAll(modelRoll?.children ?? []).find(
  (node) => node.props?.className === 'tbi-barRow' && typeof node.props?.onClick === 'function',
);
if (modelRowToPin === undefined) throw new Error('no model row to select');
modelRowToPin.props.onClick();
const pinnedFrame = await rerender();
const pinnedRoll = pinnedFrame.find((node) => node.props?.className === 'tbi-roll');
console.log('after selecting a model row:', JSON.stringify({
  open: pinnedRoll?.props['data-open'],
  pinned: pinnedRoll?.props['data-pinned'],
}));
if (pinnedRoll?.props['data-open'] !== true) {
  throw new Error('selecting a row inside the list did not pin it open');
}
if (pinnedRoll?.props['data-pinned'] !== true) {
  throw new Error('the pinned list does not report itself as pinned');
}
// Leaving it must NOT fold a pinned list.
pinnedRoll.props.onMouseLeave?.();
const stillOpen = (await rerender()).find((node) => node.props?.className === 'tbi-roll');
if (stillOpen?.props['data-open'] !== true) {
  throw new Error('leaving a pinned list folded it away');
}
// Clear the selection for the remaining checks.
const clearPin = (await rerender()).find((node) => node.props?.className === 'tbi-filterTagClose');
if (clearPin !== undefined) { clearPin.props.onClick(); await rerender(); }
// The roller is the affordance that says "there is more under here".
const rollers = nodes.filter((node) => node.props?.className === 'tbi-rollHandle');
console.log('rollers:', rollers.length);
if (rollers.length === 0) throw new Error('no roller rendered under a folded list');
//#endregion

//#region headline exact counts and the bar tooltip's session count
// The bar tooltip used to report "0 sessions" on every day: the window slice
// rebuilt the day rows without carrying the session count through. A day that
// has spend but claims zero sessions is a lie the tooltip told on every hover.
const dayTips = nodes.filter((node) => node.props?.className === 'tbi-col');
if (dayTips.length === 0) throw new Error('no day columns to hover');
// Pick a day that actually has spend. After the stacked-by-model change the
// first rect in a column is the hover shadow or the hit band, so "tallest rect"
// no longer identifies a busy day — ask the tooltip instead.
//
// The card is dwell-gated: it appears one second after the pointer comes to
// rest, so this has to wait for the timer before it can read anything.
const tipOf = async (node) => {
  node.props.onMouseEnter();
  let text = '';
  for (let pass = 0; pass < 20; pass += 1) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    dirty = false;
    effects = [];
    frameIndex = 0;
    tree = renderNode(React.createElement(page.component, { t }));
    for (const effect of effects) effect();
    const hovered = walkCurrent();
    // Several charts mount their own tooltip, so take the first one: the daily
    // card is rendered above the heatmap and the model card.
    // Several charts mount a tooltip, and a hover left over from an earlier
    // check keeps its card alive. The daily one is marked, so ask for it by
    // name instead of taking the first in tree order.
    const tip = hovered.find(
      (entry) => entry.props?.className === 'tbi-tooltip' && entry.props['data-owner'] === 'daily',
    );
    text = tip === undefined ? '' : (tip.children ?? []).map((child) => child?.[TEXT] ?? '').join('');
    if (text.length > 0) break;
  }
  return text;
};
let firstBusy;
let dayTipText = '';
// Each probe waits out the dwell timer, so only try a few columns: the first
// busy one is enough, and the fixture's recent days all have spend.
const firstProbe = await tipOf(dayTips[dayTips.length - 1]);
console.log('last-column probe:', JSON.stringify(firstProbe.slice(0, 80)));
for (const column of dayTips) {
  const text = await tipOf(column);
  if (text.includes(zh.sessionsUnit) && !text.includes(zh.noSpend)) {
    const line = text.split('\n').find((entry) => entry.includes(zh.sessionsUnit));
    if (Number(String(line).replace(/[^\d]/g, '')) > 0) {
      firstBusy = column;
      dayTipText = text;
      break;
    }
  }
}
if (firstBusy === undefined) throw new Error('no day column with real spend to inspect');
console.log('busy day column:', 'has handler');
console.log('day tooltip:', JSON.stringify(dayTipText));
const sessionLine = dayTipText.split('\n').find((line) => line.includes(zh.sessionsUnit));
console.log('session line:', JSON.stringify(sessionLine ?? ''));
if (sessionLine === undefined) throw new Error('the day tooltip lost its session line');
const declared = Number(String(sessionLine).replace(/[^\d]/g, ''));
if (!(declared > 0)) {
  throw new Error(`a day with spend claims ${declared} sessions: ${JSON.stringify(dayTipText)}`);
}

// The day tooltip also carries the cache hit share, on the same basis as the
// headline figure (cacheRead over the day's four buckets). Without it, a day
// could only be judged by its raw cacheRead, which says nothing about how much
// of that day's prompt traffic was served from cache.
//#region the card waits for the pointer to rest
// A tooltip that follows the pointer pops up on every column it crosses while
// the reader is only scanning the shape. The card must wait for stillness, stay
// put while the pointer moves inside the column, and go away on leaving the
// column's x-range.
// Use the column the earlier check already proved has spend, so the card it
// opens is the full one rather than the "no spend" variant.
const dwellColumn = firstBusy ?? dayTips[0];
dwellColumn.props.onMouseLeave();
const afterLeave = await rerender();
const tipAfterLeave = afterLeave.filter((node) => node.props?.className === 'tbi-tooltip');
const dailyAfterLeave = tipAfterLeave.find((node) => node.props['data-owner'] === 'daily');
console.log('cards after leaving the column:', tipAfterLeave.length);
if (dailyAfterLeave !== undefined) {
  const textAfterLeave = (dailyAfterLeave.children ?? []).map((child) => child?.[TEXT] ?? '').join('');
  if (textAfterLeave.includes(zh.sessionsUnit)) {
    throw new Error(`leaving the column left the day card up: ${JSON.stringify(textAfterLeave)}`);
  }
}
// A fresh hover must not show anything immediately: the point is the wait.
dwellColumn.props.onMouseEnter();
// Re-render once before reading: a synchronous setState (which is what a
// missing dwell timer degenerates to) only shows up in the next frame.
dirty = true;
const enterFrame = await collectAll(
  (() => {
    frameIndex = 0;
    effects = [];
    const next = renderNode(React.createElement(page.component, { t }));
    for (const effect of effects) effect();
    return next;
  })(),
);
const flown = enterFrame.find(
  (node) => node.props?.className === 'tbi-tooltip' && node.props['data-owner'] === 'daily',
);
if (flown !== undefined) {
  const early = (flown.children ?? []).map((child) => child?.[TEXT] ?? '').join('');
  if (early.includes(zh.sessionsUnit)) {
    throw new Error('the day card appeared before the pointer came to rest');
  }
}
// Moving within the same column keeps the pending timer running rather than
// cancelling it.
dwellColumn.props.onMouseMove();
dwellColumn.props.onMouseMove();
// One frame, not `rerender`: that helper resets the hook frames between
// passes, which would discard the state the timer just set.
await new Promise((resolve) => setTimeout(resolve, 260));
const restFrame = (() => {
  dirty = false;
  effects = [];
  frameIndex = 0;
  const next = renderNode(React.createElement(page.component, { t }));
  for (const effect of effects) effect();
  return next;
})();
const afterRest = collectAll(restFrame).find(
  (node) => node.props?.className === 'tbi-tooltip' && node.props['data-owner'] === 'daily',
);
const restText = afterRest === undefined ? '' : (afterRest.children ?? []).map((child) => child?.[TEXT] ?? '').join('');
console.log('card after the pointer rests:', JSON.stringify(restText.slice(0, 40)));
if (restText.length === 0) {
  throw new Error('the day card never appeared after the pointer rested');
}
if (!restText.includes(zh.sessionsUnit)) {
  throw new Error(`the card that opened is not the day card: ${JSON.stringify(restText.slice(0, 60))}`);
}
// The arrow in the open card marks the slice under the pointer. Moving up and
// down inside one column must move it: the card's text is rebuilt from live
// state, not frozen when the timer fired.
const openCard = () => {
  const frame = (() => {
    dirty = false;
    effects = [];
    frameIndex = 0;
    const next = renderNode(React.createElement(page.component, { t }));
    for (const effect of effects) effect();
    return next;
  })();
  const tip = collectAll(frame).find(
    (node) => node.props?.className === 'tbi-tooltip' && node.props['data-owner'] === 'daily',
  );
  return tip === undefined ? '' : (tip.children ?? []).map((child) => child?.[TEXT] ?? '').join('');
};
const arrowOf = (text) => {
  const line = text.split('\n').find((entry) => entry.startsWith('\u25b8 '));
  return line === undefined ? null : line.slice(2).split(' ')[0];
};
// Find two different model slices in the open column.
const openSlices = collectAll(dwellColumn.children ?? []).filter(
  (node) => node.tag === 'rect' && typeof node.props?.['data-model'] === 'string',
);
const distinctSlices = [];
const seenModels = new Set();
for (const slice of openSlices) {
  if (seenModels.has(slice.props['data-model'])) continue;
  seenModels.add(slice.props['data-model']);
  distinctSlices.push(slice);
}
console.log('distinct slices in the open column:', distinctSlices.length);
if (distinctSlices.length >= 2) {
  distinctSlices[0].props.onMouseEnter();
  const firstArrow = arrowOf(openCard());
  distinctSlices[1].props.onMouseEnter();
  const secondArrow = arrowOf(openCard());
  console.log('arrow over slice 1:', firstArrow, '| over slice 2:', secondArrow);
  if (firstArrow === null || secondArrow === null) {
    throw new Error('the open card lost its arrow marker');
  }
  if (firstArrow === secondArrow) {
    throw new Error(`the arrow stayed on ${firstArrow} while the pointer moved to another slice`);
  }
} else {
  console.log('note: the open column has a single model, so the arrow cannot move');
}
//#endregion

const shareLine = dayTipText.split('\n').find((line) => line.includes(zh.cacheShare));
console.log('cache share line:', JSON.stringify(shareLine ?? ''));
if (shareLine === undefined) throw new Error('the day tooltip lost its cache share line');
const shareMatch = /^(\d+\.\d)%$/.exec(String(shareLine).replace(zh.cacheShare, '').trim());
if (shareMatch === null) throw new Error(`the cache share is not a percentage: ${JSON.stringify(shareLine)}`);
const share = Number(shareMatch[1]);
if (!(share >= 0 && share <= 100)) throw new Error(`the cache share is out of range: ${share}`);

// The headline figures must publish the exact count for copying.
const exactLines = nodes.filter((node) => node.props?.className === 'tbi-figureExact');
console.log('exact-count lines:', exactLines.length, exactLines.map((node) => node.children?.[0]?.[TEXT] ?? '').join(' | '));
if (exactLines.length < 2) throw new Error('the cumulative and today figures must both expose an exact count');
for (const line of exactLines.slice(0, 2)) {
  const text = String(line.children?.[0]?.[TEXT] ?? '');
  // `exact()` prints digit groups, which is what makes the number readable and
  // still pasteable; the check only insists it is a count, not prose.
  if (!/^\d[\d,]*$/.test(text)) throw new Error(`an exact count is not a number: ${JSON.stringify(text)}`);
}
//#endregion

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
