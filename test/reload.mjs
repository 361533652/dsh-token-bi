/**
 * Reproduce the reload failure that made the plugin vanish, and prove the fix.
 *
 * `webServer.register` rejects a duplicate path. A profile hot reload runs
 * `apply` again while the previous fiber may still own its route, so a route
 * registered per instance makes the second activation throw and the plugin
 * (with its UI) disappear from the page.
 *
 *   node test/reload.mjs
 */
import { apply } from '../index.js';

/** A webServer double that behaves like the real one: duplicate paths throw. */
function createWebServer() {
  const routes = new Map();
  const log = [];
  return {
    log,
    routes,
    service: {
      register(route) {
        const key = `${route.kind}:${route.path}`;
        if (routes.has(key)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
        routes.set(key, route);
        log.push(`register ${key}`);
        return () => {
          routes.delete(key);
          log.push(`dispose ${key}`);
        };
      },
    },
  };
}

function createCtx(webServer) {
  const disposers = [];
  return {
    disposers,
    webServer: webServer.service,
    effect(factory) {
      const dispose = factory();
      disposers.push(dispose);
      return () => {};
    },
  };
}

/** Drive one request through the currently registered route. */
async function call(webServer, path) {
  const route = [...webServer.routes.values()][0];
  if (route === undefined) throw new Error('no route registered');
  return new Promise((resolve, reject) => {
    const res = {
      status: 0,
      writeHead(status) {
        this.status = status;
      },
      end(body) {
        resolve({ status: this.status, body: body ?? '' });
      },
    };
    Promise.resolve(route.handler({ url: path, headers: {} }, res)).catch(reject);
  });
}

const webServer = createWebServer();
let failures = 0;
const check = (label, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures += 1;
};

//#region 1. reload without disposing the previous instance
// This is the ordering that produced the production error.
const first = createCtx(webServer);
apply(first);
let secondError = null;
const second = createCtx(webServer);
try {
  apply(second);
} catch (error) {
  secondError = error;
}
check('second activation does not throw on a duplicate route', secondError === null);
if (secondError !== null) console.log('   error was:', secondError.message);
check('exactly one route is registered', webServer.routes.size === 1);
//#endregion

//#region 2. the surviving route still serves the newest instance
const served = await call(webServer, '/api/dsh-token-bi/unknown');
check('route answers after reload', served.status === 404);
check('route answers with the plugin JSON contract', served.body.includes('unknown route'));
//#endregion

//#region 3. disposing the superseded instance must not drop the route
for (const dispose of first.disposers) dispose();
check('route survives the superseded instance disposing', webServer.routes.size === 1);
const afterOldDispose = await call(webServer, '/api/dsh-token-bi/unknown');
check('route still answers after the old instance disposes', afterOldDispose.status === 404);
//#endregion

//#region 4. the last instance disposing does release the route
for (const dispose of second.disposers) dispose();
check('route is released once the last instance disposes', webServer.routes.size === 0);
//#endregion

//#region 5. a fresh activation after a full teardown registers again
const third = createCtx(webServer);
let thirdError = null;
try {
  apply(third);
} catch (error) {
  thirdError = error;
}
check('a later activation registers cleanly', thirdError === null && webServer.routes.size === 1);
//#endregion

console.log('\nwebServer call log:');
for (const line of webServer.log) console.log(' ', line);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nreload ok: no duplicate-route failure');