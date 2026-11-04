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
import { markSeeded, needsSeed, openLedger } from './lib/ledger.mjs';
import { rebuildLedger, syncLedger } from './lib/sync.mjs';

/** The HTTP prefix this plugin owns. */
const ROUTE = '/api/dsh-token-bi';
/** A report older than this is rebuilt even when nothing visible changed. */
const REPORT_TTL_MS = 10_000;
/**
 * How long to wait before rebuilding behind a cached answer.
 *
 * Long enough that the first paint is not competing with the rebuild's disk and
 * CPU work, short enough that a stale number corrects itself almost at once.
 */
const WARM_DELAY_MS = 750;
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
   * The persistent ledger, opened lazily on first use.
   *
   * It is the primary path: the whole report comes from SQLite, so opening the
   * panel is a handful of scans instead of a fold over 184 MB of logs. When the
   * database cannot be opened (no SQLite, unwritable directory, schema break)
   * `ledger` stays `undefined` and the old fold path takes over — slower, but
   * the panel still works.
   */
  let ledger;
  let ledgerRoot;
  let ledgerFailed = false;

  const ledgerFor = (root) => {
    if (ledgerFailed) return undefined;
    if (ledger !== undefined && ledgerRoot === root) return ledger;
    try {
      const opened = openLedger(root);
      if (opened === undefined) {
        ledgerFailed = true;
        return undefined;
      }
      ledger = opened;
      ledgerRoot = root;
      return ledger;
    } catch {
      ledgerFailed = true;
      return undefined;
    }
  };

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
   * The report, from the persistent ledger.
   *
   * The ledger is the primary path. It is kept current incrementally, so this
   * is a handful of SQL scans over a small database rather than a fold over the
   * logs. The disk is walked exactly once, to seed the sessions that predate the
   * plugin; afterwards new sessions arrive through the live list and nothing is
   * ever re-scanned.
   *
   * Returns `undefined` when the ledger cannot serve this request, and the
   * caller falls back to the log fold.
   */
  const readFromLedger = async (offsetMinutes) => {
    const storeRoot = resolveStoreRoot(ctx);
    if (storeRoot === undefined) return undefined;
    const db = ledgerFor(storeRoot);
    if (db === undefined) return undefined;
    try {
      // The only time a full sweep is needed is the very first one, to seed the
      // ledger with the sessions that already existed before this plugin was
      // installed. After that the ledger is maintained incrementally:
      //
      // - a new session is live from the instant it is created, so it arrives
      //   through `ctx.sessions.list()` — a pure in-memory read;
      // - a session that ends keeps its rows, because the bill records what was
      //   spent and nothing ever deletes it;
      // - so there is no reason to walk the disk ever again.
      const seed = needsSeed(db);
      const result = await syncLedger(ctx, db, offsetMinutes, { skipListed: seed !== true });
      // One successful seed is enough forever: everything after it arrives
      // through the live list.
      if (seed) markSeeded(db);
      const report = result.report;
      // The ledger is all-time by nature; the page slices windows locally, so
      // one shaped report serves every preset.
      report.rangeDays = 0;
      report.fromCache = false;
      report.ledger = { folded: result.folded, reused: result.reused, added: result.added };
      if (result.errors.length > 0) report.errors = result.errors;
      return report;
    } catch (error) {
      // A broken ledger must not break the panel: fall back to folding logs.
      ledgerFailed = true;
      try {
        ctx.logger?.warn?.(`[token-bi] ledger unavailable, falling back to log fold: ${error instanceof Error ? error.message : String(error)}`);
      } catch {
        // Logging must never be the thing that breaks a request.
      }
      return undefined;
    }
  };

  /**
   * Build (or reuse) the report for one window.
   *
   * Order of preference, cheapest first:
   *   1. the in-memory report, if it is younger than the TTL;
   *   2. the persistent ledger (the primary path — SQL over a small database);
   *   3. the durable cache, returned immediately (possibly stale) so the page
   *      paints at once, with a real rebuild kicked off behind it;
   *   4. a full collect, per-session cached so only changed sessions are read.
   */
  const readReport = async (offsetMinutes, rangeDays) => {
    const key = cacheKey(offsetMinutes, rangeDays);
    // Within the TTL an identical request gets the identical answer; there is
    // nothing to gain by touching the ledger again.
    if (cached !== undefined && cached.key === key && Date.now() - cached.at < REPORT_TTL_MS) {
      return cached.report;
    }
    if (building !== undefined && building.key === key) return building.promise;

    // Ledger first: it is both the fastest path and the one that keeps spend
    // after a session's log is deleted.
    {
      const fromLedger = await readFromLedger(offsetMinutes);
      if (fromLedger !== undefined) {
        cached = { at: Date.now(), key, report: fromLedger };
        return fromLedger;
      }
    }

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
              const fingerprint = storeFingerprint(storeRoot);
              saveReportCache(storeRoot, options, report, fingerprint);
              // The calendar needs a full year and asks for it separately. The
              // sessions are already folded, and the durable cache holds the
              // complete record for each (rows included) — so the annual series
              // is one aggregation away instead of a second full build.
              if (rangeDays !== 0 && storeRoot !== undefined) {
                try {
                  const complete = storeRoot === undefined ? [] : createSessionStore(storeRoot, { offsetMinutes, rangeDays: 0 });
                  const records = typeof complete?.snapshotRecords === 'function'
                    ? complete.snapshotRecords(offsetMinutes).map((entry) => entry.record)
                    : [];
                  if (records.length > 0) {
                    const annual = collector.buildReport(records, [], offsetMinutes, 0);
                    if (Array.isArray(annual.days) && annual.days.length > 0) {
                      saveReportCache(storeRoot, { offsetMinutes, rangeDays: 0 }, annual, fingerprint);
                    }
                  }
                } catch {
                  // The annual series is a bonus; never fail the main report.
                }
              }
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
        // One read, not two: `allowStale` accepts the entry regardless of the
        // fingerprint, and the returned `stale` flag says which it was.
        const hit = loadReportCache(storeRoot, { offsetMinutes, rangeDays }, storeFingerprint(storeRoot), true);
        if (hit !== undefined) {
          scheduleWarm(startBuild);
          return { ...hit.report, fromCache: true, cacheSavedAt: hit.savedAt, stale: hit.stale === true };
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
        scheduleWarm(startBuild);
        return stale;
      }
    }

    return startBuild();
  };

  /**
   * Daily totals only, for the annual heatmap.
   *
   * The page used to fetch a whole `days=0` report just to read `days`, which
   * meant building every session, model and cross-tab cell a second time on each
   * open — concurrently with the main request. The daily series is available
   * from the same window build, so reuse it and send only the small part.
   */
  const readDaily = async (offsetMinutes) => {
    // The heatmap wants a full year; the main panel wants 30 days. The annual
    // window is the expensive one, so serve it from its own cache when present.
    const storeRoot = resolveStoreRoot(ctx);
    if (storeRoot !== undefined) {
      try {
        const hit = loadReportCache(storeRoot, { offsetMinutes, rangeDays: 0 }, storeFingerprint(storeRoot), true);
        if (hit !== undefined) {
          // The annual cache is only ever rewritten as a side effect of a 30-day
          // report build. While a conversation is running, the store moves with
          // every turn, so the heatmap would otherwise keep answering with the
          // snapshot taken the last time the panel happened to open — and the
          // mismatch against the (fresh) bar chart was exactly that. When the
          // entry is stale, rebuild the year behind the response the same way
          // the report route does.
          if (hit.stale === true) {
            scheduleWarm(() => readReport(offsetMinutes, 0));
          }
          return dailyFrom(hit.report, offsetMinutes, true);
        }
      } catch {
        // Fall through.
      }
    }

    // Nothing cached yet. Answer from whatever window is already in memory so
    // the calendar still paints, and rebuild the full year behind it. An empty
    // reply would leave the heatmap blank on first open, which is exactly the
    // loading state this change is meant to remove.
    const warm = cached?.report;
    if (warm !== undefined && Array.isArray(warm.days) && warm.days.length > 0) {
      scheduleWarm(() => readReport(offsetMinutes, 0));
      return dailyFrom(warm, offsetMinutes, true);
    }

    scheduleWarm(() => readReport(offsetMinutes, 0));
    return { generatedAt: Date.now(), offsetMinutes, rangeDays: 0, days: [], fromCache: true, pending: true };
  };;

  /** The daily slice of a report, without the sessions and cross-tab. */
  const dailyFrom = (report, offsetMinutes, fromCache) => ({
    generatedAt: report?.generatedAt ?? Date.now(),
    offsetMinutes,
    rangeDays: 0,
    cutoffDay: report?.cutoffDay,
    days: Array.isArray(report?.days) ? report.days : [],
    fromCache: fromCache === true || report?.fromCache === true,
  });

  /**
   * Kick off a background rebuild *after* the response has been sent.
   *
   * Starting it inline made the first paint compete with the rebuild for disk
   * and CPU: the answer itself took ~10 ms to assemble, but the request to the
   * browser still waited behind a 5 MB cache decompress that the rebuild
   * triggered. A short timer lets the paint happen first.
   */
  const scheduleWarm = (build) => {
    if (warming !== undefined || building !== undefined) return;
    const timer = setTimeout(() => {
      try {
        warming = build();
        warming.catch(() => {});
      } catch {
        // A failed warm leaves the stale report in place; the next open retries.
      }
    }, WARM_DELAY_MS);
    // Never hold the process open just for a refresh.
    if (typeof timer?.unref === 'function') timer.unref();
  };

  /** Answer one request for this instance. */
  const serve = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '');
    const offsetMinutes = parseOffset(url.searchParams.get('offset'));
    const rangeDays = parseRange(url.searchParams.get('days'));
    try {
      if (path === `${ROUTE}/report`) {
        sendJson(res, 200, await readReport(offsetMinutes, rangeDays));
        return;
      }
      if (path === `${ROUTE}/days`) {
        sendJson(res, 200, await readDaily(offsetMinutes));
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
