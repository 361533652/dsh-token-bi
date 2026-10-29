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
const document = {
  visibilityState: 'visible',
  createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
  head: { appendChild() {} },
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

// Opening the bill is what refreshes it. The host mounts the page when the
// panel is opened, so the first report request has to skip the server cache —
// otherwise the panel opens on a snapshot taken before the click, and there is
// no timer behind it to correct the number a few seconds later.
const firstReport = requests.find((url) => url.includes('/report?'));
console.log('first report request:', firstReport);
if (firstReport === undefined) throw new Error('opening the page issued no report request');
if (!firstReport.includes('refresh=1')) {
  throw new Error(`opening the page settled for the cached report: ${firstReport}`);
}

// Refreshing on the way back into the window is what stands in for polling.
for (const expected of ['visibilitychange', 'window:focus']) {
  if (!listeners.includes(expected)) throw new Error(`page never listens for ${expected}, so a returning window shows a stale total`);
}
console.log('listeners:', listeners.join(', '));

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

const titleNode = nodes.find((node) => node.tag === 'h1');
console.log('h1:', titleNode?.children?.[0]?.[TEXT]);

if (text.trim().length < 400) throw new Error('page rendered almost nothing');
if ((tags.get('rect') ?? 0) < 4) throw new Error('daily chart produced no bars');
// A window wider than 30 days must not be truncated on the chart, otherwise
// older single-day spend is visible in the heatmap but missing from the bars.
const dailyColumns = nodes.filter((node) => node.props?.className === 'tbi-col');
console.log('daily columns:', dailyColumns.length, 'window days:', report.days.length);
if (dailyColumns.length !== report.days.length) {
  throw new Error(`daily chart drew ${dailyColumns.length} columns for a ${report.days.length}-day window`);
}
if (!text.includes(report.sessions[0].title)) throw new Error('session table did not render rows');
if (!text.includes(zh.panel) || !text.includes(zh.heatmapTitle)) {
  throw new Error('heatmap card did not render');
}

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
