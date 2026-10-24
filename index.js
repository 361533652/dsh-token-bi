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
import { createSessionStore, loadReportCache, resolveStoreRoot, saveReportCache, storeFingerprint } from './lib/cache.mjs';

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
  /** Whether a background rebuild is already scheduled for this key. */
  let warming;

  /**
   * Assemble a report straight from the durable cache, without reading any log.
   *
   * Used for the first paint after a restart: the numbers may be a few minutes
   * old (the page refetches every 60 s and a fresh build starts right away), but
   * opening the panel is instant instead of waiting on the session being typed
   * into, whose log can be tens of megabytes.
   *
   * Returns `undefined` when the cache has nothing usable for this window.
   */
  const reportFromCache = (offsetMinutes, rangeDays) => {
    const storeRoot = resolveStoreRoot(ctx);
    if (storeRoot === undefined) return undefined;
    const options = { offsetMinutes, rangeDays };

    // Cheapest: a finished report, valid only while the store is unchanged.
    try {
      const hit = loadReportCache(storeRoot, options, storeFingerprint(storeRoot));
      if (hit !== undefined) {
        const report = { ...hit.report, fromCache: true, cacheSavedAt: hit.savedAt };
        return report;
      }
    } catch {
      // Fall through to assembling from per-session records.
    }

    let store;
    try {
      store = createSessionStore(storeRoot, options);
    } catch {
      return undefined;
    }
    const entries = typeof store.snapshotRecords === 'function' ? store.snapshotRecords(offsetMinutes) : [];
    if (entries.length === 0) return undefined;

    const records = entries.map((entry) => entry.record);
    try {
      const report = collector.buildReport(records, [], offsetMinutes, rangeDays);
      // Mark it so the page can tell a warm first paint from a fresh one.
      report.fromCache = true;
      report.cacheSavedAt = store.savedAt;
      return report;
    } catch {
      return undefined;
    }
  };

  /**
   * Sessions in the store that the cache does not cover.
   *
   * Served-stale is only acceptable when it is *complete*: a session created or
   * copied in since the cache was written would otherwise be missing from the
   * totals, which reads as wrong data rather than old data.
   *
   * Ids are compared in one normalized form. The store hands out both
   * `session-<uuid>` and bare `<uuid>` spellings (internal and child sessions use
   * the bare one), and a mismatch here would disable the fast path entirely.
   */
  const cacheIsComplete = async (offsetMinutes, rangeDays) => {
    const storeRoot = resolveStoreRoot(ctx);
    if (storeRoot === undefined) return false;
    try {
      const store = createSessionStore(storeRoot, { offsetMinutes, rangeDays });
      const cachedIds = new Set(
        store.snapshotRecords(offsetMinutes).map((entry) => bareId(entry.sessionId)),
      );
      if (cachedIds.size === 0) return false;

      const query = service(ctx, 'sessionQuery');
      const sessionService = service(ctx, 'sessions');
      let listed = [];
      if (query !== undefined && typeof query.listSessions === 'function') listed = await query.listSessions();
      const live = typeof sessionService?.list === 'function' ? sessionService.list() : [];

      for (const entry of listed) {
        const id = bareId(entry?.header?.id);
        if (id.length === 0) continue;
        if (!cachedIds.has(id)) return false;
      }
      for (const session of live) {
        const id = bareId(session?.header?.id);
        if (id.length === 0) continue;
        if (!cachedIds.has(id)) return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  /**
   * Build (or reuse) the report for one window.
   *
   * Order of preference, cheapest first:
   *   1. the in-memory report, if it is younger than the TTL;
   *   2. the durable cache, returned immediately (possibly stale) so the page
   *      paints at once, with a real rebuild kicked off behind it;
   *   3. a full collect, per-session cached so only changed sessions are read.
   */
  const readReport = async (offsetMinutes, rangeDays, force) => {
    const key = cacheKey(offsetMinutes, rangeDays);
    if (!force && cached !== undefined && cached.key === key && Date.now() - cached.at < REPORT_TTL_MS) {
      return cached.report;
    }
    if (building !== undefined && building.key === key) return building.promise;

    const startBuild = () => {
      if (building !== undefined && building.key === key) return building.promise;
      const options = { offsetMinutes, rangeDays };
      const storeRoot = resolveStoreRoot(ctx);
      const sessionStore = storeRoot === undefined ? undefined : createSessionStore(storeRoot, options);
      collector.sessionStore = sessionStore;

      const promise = collector
        .collect(options)
        .then((report) => {
          cached = { at: Date.now(), key, report };
          try {
            sessionStore?.flush();
            // Persist the finished report too. It is tens of KB against the
            // session cache's megabytes, so the next cold start can serve a
            // complete report without touching either.
            if (storeRoot !== undefined) {
              saveReportCache(storeRoot, options, report, storeFingerprint(storeRoot));
            }
          } catch {
            // Persisting is best-effort; the report itself is already built.
          }
          return report;
        })
        .finally(() => {
          if (building?.promise === promise) building = undefined;
          if (warming === promise) warming = undefined;
        });
      building = { key, promise };
      return promise;
    };

    // A forced refresh always rebuilds.
    if (force) return startBuild();

    // Cheapest path: a finished report for this window. A perfect fingerprint
    // match means it is exactly current; otherwise it is still the right shape
    // and only a few seconds stale, which is what makes a restart feel instant.
    //
    // Serving it when the store has moved is deliberate. The store changes on
    // essentially every turn of the conversation you are in, so requiring an
    // exact match would disable this path permanently. The page refetches on its
    // own and the rebuild below lands within a second or two.
    const storeRoot = resolveStoreRoot(ctx);
    if (storeRoot !== undefined) {
      try {
        const exact = loadReportCache(storeRoot, { offsetMinutes, rangeDays }, storeFingerprint(storeRoot));
        const anyAge = exact ?? loadReportCache(storeRoot, { offsetMinutes, rangeDays }, undefined, true);
        if (anyAge !== undefined) {
          if (warming === undefined) {
            warming = startBuild();
            warming.catch(() => {});
          }
          return { ...anyAge.report, fromCache: true, cacheSavedAt: anyAge.savedAt };
        }
      } catch {
        // Fall through to the per-session path below.
      }
    }

    // Otherwise assemble from the per-session records, but only when the cache
    // covers every session — serving an incomplete set would read as wrong
    // numbers rather than old ones.
    if (await cacheIsComplete(offsetMinutes, rangeDays)) {
      const stale = reportFromCache(offsetMinutes, rangeDays);
      if (stale !== undefined) {
        if (warming === undefined) {
          warming = startBuild();
          // A rejected warm is surfaced by the next request.
          warming.catch(() => {});
        }
        return stale;
      }
    }

    return startBuild();
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

/**
 * Resolve an optional Host service without assuming the context proxy exposes
 * it directly as a property.
 */
function service(ctx, name) {
  if (typeof ctx.get === 'function') {
    const found = ctx.get(name);
    if (found !== undefined) return found;
  }
  try {
    return ctx[name];
  } catch {
    return undefined;
  }
}

/**
 * One normalized session id.
 *
 * The store reports the same session as either `session-<uuid>` or plain
 * `<uuid>` depending on how it was enumerated, so comparisons have to strip the
 * prefix or they never match.
 */
function bareId(id) {
  if (typeof id !== 'string') return '';
  return id.startsWith('session-') ? id.slice('session-'.length) : id;
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
