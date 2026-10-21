/**
 * dsh-token-bi 鈥?Host half.
 *
 * Serves the cross-session token report the browser page charts:
 *   GET /api/dsh-token-bi/report?offset=<minutes>&days=<window>&refresh=1
 *   GET /api/dsh-token-bi/session?id=<session id>&offset=<minutes>
 *
 * The route is a plain `webServer` prefix route, the same seam other profile
 * plugins use; the browser half only renders what this returns.
 *
 * Registration is process-wide and idempotent. `webServer.register` rejects a
 * second route on the same path, and a hot reload reloads this module while the
 * previous fiber may still own its route 鈥?so a per-instance registration makes
 * every reload fail and the plugin (and its UI) disappear. Instead one route is
 * installed for the process and each instance becomes its current handler.
 */
import { UsageCollector } from './lib/collector.mjs';

/** The HTTP prefix this plugin owns. */
const ROUTE = '/api/dsh-token-bi';
/** A report older than this is rebuilt even when nothing visible changed. */
const REPORT_TTL_MS = 10_000;
/** Process-global route holder; survives a module reload with the page. */
const ROUTE_SLOT = Symbol.for('dsh-token-bi/route');

export const name = 'token-bi';
export const inject = ['webServer'];

/**
 * Options that let the {@link REPORT_TTL_MS} cache key cover the window too, so
 * switching ranges never serves the other window's numbers.
 */
function cacheKey(offsetMinutes, rangeDays) {
  return `${offsetMinutes}:${rangeDays}`;
}

export function apply(ctx) {
  const collector = new UsageCollector(ctx);
  let cached;
  let building;

  const readReport = (offsetMinutes, rangeDays, force) => {
    const key = cacheKey(offsetMinutes, rangeDays);
    if (!force && cached !== undefined && cached.key === key && Date.now() - cached.at < REPORT_TTL_MS) {
      return Promise.resolve(cached.report);
    }
    if (building !== undefined && building.key === key) return building.promise;
    const promise = collector
      .collect({ offsetMinutes, rangeDays })
      .then((report) => {
        cached = { at: Date.now(), key, report };
        return report;
      })
      .finally(() => {
        if (building?.promise === promise) building = undefined;
      });
    building = { key, promise };
    return promise;
  };

  /** Answer one request for this instance. */
  const serve = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '');
    const offsetMinutes = parseOffset(url.searchParams.get('offset'));
    const rangeDays = parseRange(url.searchParams.get('days'));
    try {
      if (path === `${ROUTE}/report`) {
        sendJson(res, 200, await readReport(offsetMinutes, rangeDays, url.searchParams.get('refresh') === '1'));
        return;
      }
      if (path === `${ROUTE}/session`) {
        const id = url.searchParams.get('id');
        if (typeof id !== 'string' || id.length === 0) {
          sendJson(res, 400, { error: 'a session id is required' });
          return;
        }
        sendJson(res, 200, await collector.sessionDetail(id, offsetMinutes));
        return;
      }
      sendJson(res, 404, { error: `unknown route ${path}` });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };

  ctx.effect(() => {
    const holder = (globalThis[ROUTE_SLOT] ??= { current: undefined, dispose: undefined });
    // A superseded instance keeps serving until the newer one takes over, so a
    // reload never leaves the route pointing at a disposed collector.
    holder.current = serve;
    if (holder.dispose === undefined) {
      holder.dispose = ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: (req, res) => holder.current(req, res),
      });
    }

    return () => {
      if (holder.current === serve) holder.current = undefined;
      // Only the instance that owns the process route releases it; a reloaded
      // instance still holding the slot keeps the route alive.
      if (holder.current === undefined && holder.dispose !== undefined) {
        holder.dispose();
        holder.dispose = undefined;
        delete globalThis[ROUTE_SLOT];
      }
      collector.invalidate();
      cached = undefined;
      building = undefined;
    };
  }, 'token-bi: report route');
}

function parseOffset(raw) {
  const fallback = -new Date().getTimezoneOffset();
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(-840, Math.min(840, Math.trunc(value)));
}

/** Window in whole days; `0` and anything unparseable mean "everything". */
function parseRange(raw) {
  if (raw === null || raw === 'all') return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(3650, Math.trunc(value));
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}
