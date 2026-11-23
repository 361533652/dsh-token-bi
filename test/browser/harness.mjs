/**
 * A real page for the browser half of the panel.
 *
 * `test/render.mjs` walks React's element tree in a hand-rolled stand-in with no
 * layout. That can prove "the source calls swapAdjacent", and it did — while the
 * board stayed frozen under a real pointer, six revisions in a row. The reason
 * is structural: with no layout, `getBoundingClientRect()` returns zeroes,
 * `translate()` lands on a node nobody paints, and the only thing a test can
 * assert is *that code exists*, not *what the reader sees*.
 *
 * This module serves the same `lib/client.js` into headless Chrome with the
 * real React 18, the real stylesheet, and a real grid, so a test can press,
 * move and release an actual pointer and then read back `transform`, computed
 * styles and `getBoundingClientRect()`.
 *
 *   import { startHarness } from './harness.mjs';
 *   const harness = await startHarness();
 *   await harness.open();            // browser + page, fixtures installed
 *   await harness.close();
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildSyntheticReport, buildSyntheticDetail } from './fixture.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..');

//#region browser resolution
/**
 * A Chromium to drive.
 *
 * playwright-core ships no browser, and downloading one per test run is a
 * network dependency the plugin's suite does not otherwise have. Use whatever
 * Chrome/Edge the machine already has, and say exactly which one was used so a
 * "works on my machine" difference is visible in the log.
 */
const CHROME_CANDIDATES = [
  process.env.TBI_CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);

export function resolveChromium() {
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    'no Chrome/Edge found for the browser suite; set TBI_CHROME to an executable path',
  );
}
//#endregion

//#region page bootstrap
/**
 * The DSH design tokens the panel reads.
 *
 * Not decoration: the grid's column widths, the tile heights and every
 * rectangle the drag maths compares against come from these. A page with no
 * theming would still be measurable, but the geometry would not be the geometry
 * the reader sees.
 */
const TOKENS = `
  :root {
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-alias-bg-layer-2: #f6f7f8;
    --dsw-alias-bg-layer-3: #eef0f2;
    --dsw-alias-border-l1: #d7dade;
    --dsw-alias-border-l2: #e4e6e9;
    --dsw-alias-border-l3: #c9cdd2;
    --dsw-alias-label-primary: #14161a;
    --dsw-alias-label-secondary: #5b626b;
    --dsw-alias-label-tertiary: #8b939c;
    --dsw-alias-state-business-primary: #2f6bff;
    --dsw-alias-state-success-primary: #12a150;
    --dsw-alias-state-warning-primary: #d98300;
    --dsw-alias-state-warn-primary: #d98300;
    --dsw-alias-state-error-primary: #d92d20;
    --dsw-alias-interactive-bg-hover: #eef1f5;
    --dsw-alias-interactive-bg-active: #e3e8ef;
    --dsw-alias-tooltip-bg: #1c1f24;
    --dsw-alias-toast-label: #ffffff;
    --dsw-radius-xs: 4px;
    --dsw-radius-sm: 6px;
    --dsw-radius-md: 10px;
    --ds-font-family-code: ui-monospace, SFMono-Regular, Menlo, monospace;
    --ds-ease-in-out: cubic-bezier(.4, 0, .2, 1);
    --ds-transition-duration-fast: .12s;
  }
  html, body { margin: 0; height: 100%; }
  body { background: #fff; font: 13px/20px "Segoe UI", system-ui, sans-serif; }
  #root { height: 100vh; min-height: 0; display: flex; }
  #root > * { flex: 1; min-width: 0; }
`;

/**
 * The bootstrap that turns `lib/client.js` into a mounted page.
 *
 * It has to reproduce three things the Host normally provides: the module
 * loader, the locale/slot context, and the same-origin API. Everything else — 
 * React, the DOM, the stylesheet, the pointer — is real.
 */
/**
 * The Host's module loader, installed *before* `client.js` runs.
 *
 * `client.js` registers itself at top level (`window.__ModuleLoader__.load(...)`),
 * so a loader defined afterwards is a page that silently dies before mounting — 
 * which is exactly what the first run of this harness did.
 */
const PRELOADER = `
window.__ModuleLoader__ = {
  loaded: null,
  load(candidate) { window.__ModuleLoader__.loaded = candidate; },
};
`;

const BOOTSTRAP = `
(function () {
  const React = window.React;
  const ReactDOM = window.ReactDOM;
  const state = window.__TBI_STATE__;
  const report = state.report;
  const detail = state.detail;
  const registration = window.__ModuleLoader__.loaded;
  if (registration === undefined || registration === null) {
    throw new Error('client.js never registered a module with the loader');
  }

  // Same-origin API, backed by the fixture. Layout writes are recorded so a
  // test can assert what was persisted, not just what was painted.
  const layoutReads = [];
  const layoutWrites = [];
  const otherRequests = [];
  const json = (body) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  });
  window.fetch = async (url, init) => {
    const target = String(url);
    const method = init?.method ?? 'GET';
    if (target.includes('/api/dsh-token-bi/layout')) {
      if (method === 'GET') {
        layoutReads.push(Date.now());
        return json({ layout: state.layout ?? undefined });
      }
      const body = JSON.parse(init.body);
      layoutWrites.push({ at: Date.now(), order: body.order });
      state.layout = body;
      return json({ ok: true, layout: body });
    }
    if (target.includes('/api/dsh-token-bi/report')) {
      otherRequests.push({ at: Date.now(), url: target });
      return json(report);
    }
    if (target.includes('/api/dsh-token-bi/session')) {
      otherRequests.push({ at: Date.now(), url: target });
      return json(detail);
    }
    if (target.includes('/api/jet-hub')) {
      return json({ result: { ok: true, value: { provider: 'qodercn' } } });
    }
    otherRequests.push({ at: Date.now(), url: target });
    return json({});
  };

  const dictionaries = {};
  const registrations = [];
  const ctx = {
    effect(factory) {
      const dispose = factory();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    locale: {
      register(namespace, dicts) { dictionaries[namespace] = dicts; return () => {}; },
      bind(namespace) { return (key) => dictionaries[namespace]?.zh?.[key] ?? key; },
    },
    slots: {
      inject(_name, callback) { callback(); },
      register(options, component) { registrations.push({ options, component }); return () => {}; },
    },
  };

  // The console is part of the evidence: a drag that throws halfway through
  // still leaves a plausible-looking board behind.
  const consoleErrors = [];
  const originalError = console.error;
  console.error = function (...args) {
    consoleErrors.push(args.map((value) => String(value)).join(' '));
    originalError.apply(console, args);
  };
  window.addEventListener('error', (event) => consoleErrors.push(String(event.message)));

  const factory = registration.factory((id) => {
    if (id === 'react') return React;
    throw new Error('unexpected external ' + id);
  });
  factory.apply(ctx);

  const page = registrations.find((row) => row.options.name === 'main');
  const t = (key) => dictionaries.tokenBi?.zh?.[key] ?? key;
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(React.createElement(page.component, { t }));

  window.__TBI__ = {
    state,
    layoutReads,
    layoutWrites,
    otherRequests,
    consoleErrors,
    registrations: registrations.map((row) => row.options.name),
    /** Resolve after React has committed and the browser has painted. */
    settled(frames = 2) {
      return new Promise((resolve) => {
        let left = frames;
        const tick = () => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    },
    /** The tile order as painted, top-left to bottom-right. */
    tileOrder() {
      return [...document.querySelectorAll('.tbi-figureTile')].map((tile) => {
        const label = tile.querySelector('.tbi-figureLabel');
        return { id: tile.dataset.cardId ?? null, label: label?.textContent ?? '' };
      });
    },
    /** Every tile's painted rectangle, in DOM order. */
    tileRects() {
      return [...document.querySelectorAll('.tbi-figureTile')].map((tile) => {
        const rect = tile.getBoundingClientRect();
        return {
          label: tile.querySelector('.tbi-figureLabel')?.textContent ?? '',
          left: rect.left, top: rect.top, width: rect.width, height: rect.height,
          dragging: tile.dataset.dragging === 'true',
          transform: getComputedStyle(tile).transform,
          transitionDuration: getComputedStyle(tile).transitionDuration,
        };
      });
    },
  };
})();
`;

function pageHtml({ report, detail, layout }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-token-bi drag harness</title>
<style>${TOKENS}</style>
</head>
<body>
<div id="root"></div>
<script>window.__TBI_STATE__ = ${JSON.stringify({ report, detail, layout: layout ?? null })};</script>
<script>${PRELOADER}</script>
<script src="/vendor/react.js"></script>
<script src="/vendor/react-dom.js"></script>
<script src="/vendor/client.js"></script>
<script>${BOOTSTRAP}</script>
</body>
</html>`;
}
//#endregion

//#region server
const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/**
 * Serve the page, the plugin and the two UMD bundles from one origin.
 *
 * One origin matters: the panel fetches `/api/dsh-token-bi/...` with
 * `credentials: 'same-origin'`, and a file:// page or a cross-origin stub would
 * change the request behaviour the suite is meant to observe.
 */
export async function startHarness(options = {}) {
  const report = options.report ?? buildSyntheticReport();
  const detail = options.detail ?? buildSyntheticDetail(report);
  const layout = options.layout ?? null;
  const vendor = {
    '/vendor/react.js': join(projectRoot, 'node_modules', 'react', 'umd', 'react.development.js'),
    '/vendor/react-dom.js': join(projectRoot, 'node_modules', 'react-dom', 'umd', 'react-dom.development.js'),
    // Overridable so the suite can be run against a proposed fix (or a
    // deliberately broken copy) without touching the checked-in file. An
    // assertion that cannot be shown to go green is not an assertion.
    '/vendor/client.js': options.clientPath ?? join(projectRoot, 'lib', 'client.js'),
  };
  const html = pageHtml({ report, detail, layout });

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (path === '/' || path === '/index.html') {
      res.writeHead(200, { 'content-type': CONTENT_TYPES['.html'] });
      res.end(html);
      return;
    }
    const file = vendor[path];
    if (file !== undefined) {
      res.writeHead(200, { 'content-type': CONTENT_TYPES['.js'] });
      res.end(readFileSync(file));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;

  let browser;
  let page;
  const harness = {
    url,
    report,
    async open({ viewport = { width: 1280, height: 900 }, deviceScaleFactor = 1, headed = false, slowMo = 0 } = {}) {
      const executablePath = resolveChromium();
      browser = await chromium.launch({
        executablePath,
        // Headless by default so the suite runs unattended. `--headed` is there
        // for the case a fix "passes" and a human needs to watch it happen — 
        // the acceptance run is the same either way, only the window differs.
        headless: headed !== true,
        slowMo,
        args: ['--force-device-scale-factor=1', '--disable-lcd-text', '--hide-scrollbars'],
      });
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor,
        // A drag that moves the pointer is only half the gesture; a second
        // pointer source (touch) is a different test, run explicitly.
        hasTouch: false,
      });
      page = await context.newPage();
      page.on('pageerror', (error) => {
        harness.pageErrors.push(String(error));
      });
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__TBI__ !== undefined, null, { timeout: 15_000 });
      await page.evaluate(() => window.__TBI__.settled(3));
      harness.page = page;
      harness.browser = browser;
      harness.executablePath = executablePath;
      return harness;
    },
    pageErrors: [],
    async close() {
      if (browser !== undefined) await browser.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  return harness;
}
//#endregion
