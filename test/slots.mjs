/**
 * Mount the real `SlotCore` and run the plugin's client registration against
 * it, with a stub slot tree that mirrors what the shipped sidebar declares.
 *
 * This catches the failure a browser would show as "silently no entry": a slot
 * that is not declared yet, or a registration that throws.
 *
 *   node test/slots.mjs
 *
 * `SlotCore` ships inside the DSH installation, so the test needs to find it:
 * set `DSH_APP_DIR` to the app root (the directory holding `node_modules`), for
 * example `E:\dsh\DSH Desktop\resources\app`. Without it the test skips.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Locate the shipped `dsh-client-ui-slots` entry point, or explain why not. */
function findSlotCore() {
  const candidates = [];
  if (process.env.DSH_APP_DIR) candidates.push(join(process.env.DSH_APP_DIR, 'node_modules'));
  // A profile's node_modules hoists the DSH packages beside the bundles.
  const profile = process.env.DSH_PROFILE_DIR;
  if (profile) candidates.push(join(profile, 'node_modules'));

  for (const root of candidates) {
    const entry = join(root, '@deepseek-ai', 'dsh-client-ui-slots', 'lib', 'index.js');
    if (existsSync(entry)) return entry;
  }
  return undefined;
}

const slotCorePath = findSlotCore();
if (slotCorePath === undefined) {
  console.log('SKIP  dsh-client-ui-slots not found');
  console.log('      set DSH_APP_DIR to the DSH app root (the directory containing node_modules)');
  process.exit(0);
}

const { SlotCore } = await import(pathToFileURL(slotCorePath).href);

//#region module capture
let React = null;
let registration = null;

const createElement = (type, props, ...children) => {
  const flat = children.length === 0 ? props?.children : children.length === 1 ? children[0] : children;
  return { type, props: { ...(props ?? {}), children: flat } };
};
React = {
  createElement,
  Fragment: Symbol('Fragment'),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useMemo: (factory) => factory(),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
};

const window = {
  __ModuleLoader__: { load: (candidate) => { registration = candidate; } },
  setInterval: () => 0,
  clearInterval: () => {},
};
const document = {
  visibilityState: 'visible',
  createElement: () => ({ dataset: {}, remove() {}, textContent: '' }),
  head: { appendChild() {} },
};
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
new Function('window', 'document', source)(window, document);
const moduleExports = registration.factory((id) => {
  if (id === 'react') return React;
  throw new Error(`unexpected external ${id}`);
});
//#endregion

//#region slot tree
const slots = new SlotCore();

/** Declare the shell exactly the way the shipped layout and sidebar plugins do. */
function declareShell() {
  // ui-layout owns `root` and declares the seats inside it.
  slots.register(
    {
      name: 'root',
      children: {
        sidebar: { kind: 'single', scope: 'root' },
        main: { kind: 'keyed', scope: 'root' },
        settings: { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    },
    { displayName: 'AppFrame' },
  );
  // ui-sidebar owns `sidebar` and declares its seats.
  slots.register(
    {
      name: 'sidebar',
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'sidebar.toggle.badge': { kind: 'single', scope: 'root' },
        'sidebar.panellist': { kind: 'list', scope: 'root' },
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
    },
    { displayName: 'SidebarRoot' },
  );
}
//#endregion

const events = [];
const dictionaries = {};
const own = [];
const ctx = {
  effect(factory) {
    const dispose = factory();
    own.push(dispose);
    return typeof dispose === 'function' ? dispose : () => {};
  },
  locale: {
    register(namespace, dicts) {
      if (namespace in dictionaries) throw new Error(`locale namespace "${namespace}" already registered`);
      dictionaries[namespace] = dicts;
      return () => { delete dictionaries[namespace]; };
    },
    bind: (namespace) => (key) => dictionaries[namespace]?.zh?.[key] ?? key,
  },
  slots: {
    /** Mirrors the renderer: the callback runs only once the slot is declared. */
    inject(key, callback) {
      events.push(`inject:${key}`);
      if (slots.specDynamic(key) !== undefined) callback();
      return () => {};
    },
    register(options, component) {
      const dispose = slots.register(options, component);
      events.push(`registered:${options.name}:${options.id ?? options.key ?? ''}`);
      return dispose;
    },
    entriesOfSlot: (key) => slots.entriesOfSlot(key),
    subscribe: (key, fn) => slots.subscribe(key, fn),
  },
};

declareShell();
console.log('shell declared; panel entries before plugin:', slots.entriesOfSlot('sidebar.panellist').length);

// A settings shell that is mounted declares the section slot; this plugin must
// not contribute one, so the declaration is present but stays unoccupied.
slots.register(
  {
    name: 'settings',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  },
  null,
);
try {
  moduleExports.apply(ctx);
} catch (error) {
  console.error('apply() threw:', error);
  process.exit(1);
}

await new Promise((resolve) => setTimeout(resolve, 10));

const panels = slots.entriesOfSlot('sidebar.panellist');
const mains = slots.entriesOfSlot('main');
console.log('events:', events.join(', '));
console.log('sidebar.panellist entries:', panels.length, panels.map((row) => row.options.id).join(','));
console.log('main entries:', mains.length, mains.map((row) => row.options.key).join(','));
console.log('settings.section entries:', slots.entriesOfSlot('settings.section').length);

let failed = false;
if (panels.length !== 1 || panels[0].options.id !== 'token-bi') {
  console.error('FAIL: the sidebar panel entry was not registered');
  failed = true;
}
if (mains.length !== 1 || mains[0].options.key !== 'token-bi') {
  console.error('FAIL: the main panel entry was not registered');
  failed = true;
}
// The settings page was removed on request: nothing may occupy that slot.
if (slots.entriesOfSlot('settings.section').length !== 0) {
  console.error('FAIL: the plugin still registers a settings section');
  failed = true;
}
const label = panels[0]?.options.label;
console.log('panel label is function:', typeof label === 'function');
if (typeof label === 'function') console.log('panel label resolves to:', JSON.stringify(label()));
if (!failed) console.log('slots ok');
process.exit(failed ? 1 : 0);
