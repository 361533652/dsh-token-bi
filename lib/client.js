/**
 * Cross-session token report — browser half.
 *
 * A sidebar panel ("Token 账单") whose main page is the report: headline
 * numbers, a daily stacked column chart, a recent-hours area line, a model
 * split, a workspace split, a session table with an inline turn timeline and a
 * call-tree view, and a drill-down drawer per session.
 *
 * Everything numeric comes from `/api/dsh-token-bi/report`; this module only
 * folds it into shapes the charts need.
 */
window.__ModuleLoader__.load({
  id: 'dsh-token-bi',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    // Load breadcrumb. A client plugin that never activates leaves no console
    // output at all, and the Desktop host only mirrors `error`-level console
    // lines into its log — so these marks use console.error deliberately, and
    // the "[token-bi]" prefix is what makes them findable there.
    const breadcrumb = (stage, detail) => {
      try {
        console.error(`[token-bi] ${stage}${detail === undefined ? '' : ` ${detail}`}`);
      } catch {
        // A console that throws is not worth failing the plugin over.
      }
    };
    breadcrumb('factory');

    const NS = 'tokenBi';
    const PANEL_ID = 'token-bi';
    const API = '/api/dsh-token-bi';
    /** Report windows, in days; `0` is the whole history. */
    const RANGES = [7, 30, 0];

    const zh = {
      'panel': 'Token 账单',
      'title': 'Token 账单',
      'subtitle': '按会话、模型、工作区和日期汇总的 token 消耗',
      'loading': '正在读取会话日志…',
      'refresh': '刷新',
      'refreshing': '正在汇总…',
      'empty': '还没有任何 token 用量记录',
      'emptyHint': '发起一次对话后，这里会出现消耗数据。',
      'error': '读取失败',
      'totalTokens': '累计 token',
      'totalSessions': '会话',
      'totalTurns': '轮次',
      'cacheShare': '缓存命中占比',
      'todayTokens': '今日消耗',
      'dailyTitle': '每日消耗',
      'dailyHint': '按日堆叠：输入 / 输出 / 缓存读 / 缓存写',
      'hourlyTitle': '最近 7 天节奏',
      'hourlyHint': '按小时聚合的总量，看什么时候在烧 token',
      'modelTitle': '模型分布',
      'cwdTitle': '工作区分布',
      'sessionTitle': '会话明细',
      'sessionHint': '点击任意一行展开逐轮时间线',
      'treeTitle': '调用树',
      'treeHint': '每个会话自己的消耗，与它派生的子会话所占的份额',
      'ownShare': '自身',
      'childShare': '子会话',
      'timelineTitle': '轮次时间线',
      'columnSession': '会话',
      'columnModel': '模型',
      'columnTokens': 'Token',
      'columnTurns': '轮次',
      'columnLast': '最近活动',
      'columnCache': '缓存命中',
      'legendInput': '输入',
      'legendOutput': '输出',
      'legendCacheRead': '缓存读',
      'legendCacheWrite': '缓存写',
      'detailTurns': '轮次消耗',
      'detailModels': '模型',
      'detailNoRows': '该会话没有可展开的逐轮记录',
      'close': '关闭',
      'live': '进行中',
      'stale': '历史',
      'sessionsUnit': '个会话',
      'turnsUnit': '轮',
      'noModel': '未记录模型',
      'subagent': '子代理',
      'root': '主会话',
      'sessionCount': '会话数',
      'tokensShort': 'token',
      'expandAll': '展开全部',
      'collapseAll': '收起全部',
      'rangeLabel': '时间范围',
      'rangeAll': '全部',
      'rangeUnit': ' 天',
      'agoNow': '刚刚',
      'agoMinutes': ' 分钟前',
      'agoHours': ' 小时前',
      'agoDays': ' 天前',
      'exportCsv': '导出 CSV',
      'rangeSummary': '统计窗口',
      'truncatedNote': '另有 {n} 个工作区未列出，合计 {tokens} tokens',
      'filterAll': '全部',
      'filterLive': '进行中',
      'filterCold': '历史',
      'unknownModel': '未记录',
      'generatedAt': '汇总于',
      'detailStep': '步',
      'detailModel': '调用模型',
      'detailTime': '时刻',
      'detailTokens': '消耗',
    };

    const en = {
      'panel': 'Token ledger',
      'title': 'Token ledger',
      'subtitle': 'Token spend aggregated by session, model, workspace and day',
      'loading': '正在读取会话日志…',
      'refresh': 'Refresh',
      'refreshing': '正在汇总…',
      'empty': 'No token usage recorded yet',
      'emptyHint': 'Start a conversation and the numbers appear here.',
      'error': 'Read failed',
      'totalTokens': 'Total tokens',
      'totalSessions': 'Sessions',
      'totalTurns': 'Turns',
      'cacheShare': 'Cache hit share',
      'todayTokens': 'Today',
      'dailyTitle': 'Daily spend',
      'dailyHint': 'Stacked per day: input / output / cache read / cache write',
      'hourlyTitle': 'Last 7 days',
      'hourlyHint': '按小时聚合的总量，看什么时候在烧 token',
      'modelTitle': 'By model',
      'cwdTitle': 'By workspace',
      'sessionTitle': 'Sessions',
      'sessionHint': 'Click a row to expand its per-turn timeline',
      'treeTitle': 'Call tree',
      'treeHint': 'What each session spent itself, and the share its delegated children took',
      'ownShare': 'Own',
      'childShare': 'Children',
      'timelineTitle': 'Turn timeline',
      'columnSession': 'Session',
      'columnModel': 'Model',
      'columnTokens': 'Tokens',
      'columnTurns': 'Turns',
      'columnLast': 'Last activity',
      'columnCache': 'Cache hit',
      'legendInput': 'Input',
      'legendOutput': 'Output',
      'legendCacheRead': 'Cache read',
      'legendCacheWrite': 'Cache write',
      'detailTurns': 'Per-turn usage',
      'detailModels': 'Models',
      'detailNoRows': 'This session has no per-turn rows to expand',
      'close': 'Close',
      'live': 'Live',
      'stale': 'Archived',
      'sessionsUnit': 'sessions',
      'turnsUnit': 'turns',
      'noModel': 'No model recorded',
      'subagent': 'Subagent',
      'root': 'Root',
      'sessionCount': 'Sessions',
      'tokensShort': 'tokens',
      'expandAll': 'Expand all',
      'collapseAll': 'Collapse all',
      'rangeLabel': 'Time range',
      'rangeAll': 'All',
      'rangeUnit': 'd',
      'agoNow': 'just now',
      'agoMinutes': 'm ago',
      'agoHours': 'h ago',
      'agoDays': 'd ago',
      'exportCsv': 'Export CSV',
      'rangeSummary': 'Window',
      'truncatedNote': '{n} more workspaces, {tokens} tokens in total',
      'filterAll': 'All',
      'filterLive': 'Live',
      'filterCold': 'Archived',
      'unknownModel': 'Not recorded',
      'generatedAt': 'Aggregated',
      'detailStep': 'Step',
      'detailModel': 'Model',
      'detailTime': 'Timestamp',
      'detailTokens': 'Usage',
    };

    //#region styles
    const CSS = `
.tbi-root{--tbi-fill-input:var(--dsw-alias-state-business-primary);--tbi-fill-output:var(--dsw-alias-state-warn-primary);--tbi-fill-cache-read:color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, transparent);--tbi-fill-cache-write:color-mix(in srgb, var(--dsw-alias-state-success-primary) 55%, transparent);box-sizing:border-box;height:100%;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;overflow:hidden}
.tbi-scroll{flex:1;min-height:0;overflow:auto;padding:0 clamp(20px,3vw,40px) 48px}
.tbi-inner{width:100%;max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:28px}
.tbi-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding-top:28px}
[data-platform=darwin] .tbi-head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.tbi-headText{min-width:0}
.tbi-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.tbi-sub{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.tbi-tools{display:flex;align-items:center;gap:8px;flex:none}
.tbi-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.tbi-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tbi-btn[data-active=true]{background:var(--dsw-alias-interactive-bg-active);border-color:var(--dsw-alias-border-l3)}
.tbi-btn:disabled{opacity:.55;cursor:default}
.tbi-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-3)}
.tbi-segBtn{height:24px;padding:0 8px;border:none;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.tbi-segBtn:hover{color:var(--dsw-alias-label-primary)}
.tbi-segBtn[data-active=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.tbi-figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;background:var(--dsw-alias-border-l2);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);overflow:hidden}
.tbi-figure{background:var(--dsw-alias-bg-layer-1);padding:14px 16px 16px}
.tbi-figureLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.tbi-figureValue{margin-top:6px;font-size:24px;line-height:32px;font-weight:500;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.tbi-figureUnit{margin-left:4px;font-size:12px;font-weight:400;color:var(--dsw-alias-label-tertiary)}
.tbi-figureNote{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.tbi-card{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:16px}
.tbi-cardHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px}
.tbi-cardTitle{margin:0;font-size:14px;font-weight:500;line-height:22px}
.tbi-cardHint{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.tbi-legend{display:flex;flex-wrap:wrap;gap:12px;color:var(--dsw-alias-label-secondary);font-size:11px}
.tbi-legendItem{display:inline-flex;align-items:center;gap:5px}
.tbi-swatch{width:9px;height:9px;border-radius:2px;display:inline-block}
.tbi-chart{width:100%;display:block;overflow:visible}
.tbi-axis{fill:var(--dsw-alias-label-tertiary);font-size:10px}
.tbi-grid{stroke:var(--dsw-alias-border-l2);stroke-width:1;shape-rendering:crispEdges}
.tbi-col{transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.tbi-col:hover{opacity:.72}
.tbi-barRow{display:grid;grid-template-columns:minmax(90px,160px) 1fr auto;align-items:center;gap:12px;padding:5px 0}
.tbi-barName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:12px}
.tbi-barName small{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-left:6px}
.tbi-barTrack{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.tbi-barFill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary)}
.tbi-barValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.tbi-table{width:100%;border-collapse:collapse;font-size:12px}
.tbi-table th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-1);text-align:left;font-weight:400;color:var(--dsw-alias-label-tertiary);padding:0 10px 8px;white-space:nowrap;border-bottom:1px solid var(--dsw-alias-border-l2)}
.tbi-table th[data-align=right],.tbi-table td[data-align=right]{text-align:right}
.tbi-table td{padding:9px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:middle}
.tbi-table tbody tr[data-clickable=true]{cursor:pointer}
.tbi-table tbody tr[data-clickable=true]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tbi-sessionName{display:flex;align-items:center;gap:8px;min-width:0}
.tbi-caret{width:12px;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.tbi-caret[data-open=true]{transform:rotate(90deg)}
.tbi-sessionTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px}
.tbi-pill{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:999px;font-size:10px;line-height:16px;white-space:nowrap;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.tbi-pill[data-live=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);color:var(--dsw-alias-state-success-primary)}
.tbi-pill[data-sub=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-state-business-primary)}
.tbi-num{font-variant-numeric:tabular-nums}
.tbi-weak{color:var(--dsw-alias-label-tertiary)}
.tbi-detailRow td{background:var(--dsw-alias-bg-layer-2);padding:0}
.tbi-detail{padding:14px 16px 18px;display:flex;flex-direction:column;gap:12px}
.tbi-spark{width:100%;display:block;overflow:visible}
.tbi-turnList{display:flex;flex-direction:column;gap:3px;max-height:360px;overflow:auto}
.tbi-turnHeader{display:grid;grid-template-columns:80px 180px 75px 1fr 80px;align-items:center;gap:12px;padding:4px 8px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l3);margin-bottom:2px}
.tbi-turnRow{display:grid;grid-template-columns:80px 180px 75px 1fr 80px;align-items:center;gap:12px;padding:4px 8px;font-size:11px;border-radius:var(--dsw-radius-xs);transition:background 0.15s ease}
.tbi-turnRow:hover{background:var(--dsw-alias-bg-layer-3)}
.tbi-turnLabel{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-weight:500}
.tbi-turnModel{color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tbi-turnTime{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px}
.tbi-turnBar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;display:flex}
.tbi-turnSeg{height:100%}
.tbi-turnTotal{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:500}
.tbi-tree{display:flex;flex-direction:column;gap:2px}
.tbi-treeRow{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;padding:4px 0}
.tbi-treeLabel{display:flex;align-items:center;gap:6px;min-width:0}
.tbi-treeBranch{color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:11px;flex:none;white-space:pre}
.tbi-treeName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
.tbi-treeBar{display:flex;align-items:center;gap:8px}
.tbi-treeTrack{width:140px;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;display:flex}
.tbi-treeFill{height:100%;background:var(--dsw-alias-state-business-primary)}
.tbi-treeFillChild{height:100%;background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 34%, transparent)}
.tbi-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:56px 16px;color:var(--dsw-alias-label-tertiary);text-align:center}
.tbi-emptyTitle{color:var(--dsw-alias-label-secondary);font-size:14px}
.tbi-error{margin:0;padding:10px 12px;border-radius:var(--dsw-radius-sm);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);color:var(--dsw-alias-state-error-primary);font-size:12px}
.tbi-foot{color:var(--dsw-alias-label-tertiary);font-size:11px;display:flex;gap:12px;flex-wrap:wrap}
.tbi-split{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.tbi-tooltip{position:fixed;z-index:60;pointer-events:none;padding:6px 8px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-alias-toast-label);font-size:11px;line-height:16px;white-space:pre;border:1px solid var(--dsw-alias-border-l3);transform:translate(-50%,-100%)}
`;
    //#endregion

    //#region formatting helpers
    const compact = (value) => {
      const n = Number(value) || 0;
      if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 1 : 2)}B`;
      if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M`;
      if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
      return String(Math.round(n));
    };
    const exact = (value) => (Number(value) || 0).toLocaleString('zh-CN');
    const percent = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—');
    const pad = (value) => String(value).padStart(2, '0');
    const dayLabel = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
    const exactTime = (ms, offsetMinutes) => {
      if (!Number.isFinite(ms)) return '—';
      const shifted = new Date(ms + offsetMinutes * 60_000);
      return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
    };
    const timeLabel = (ms, offsetMinutes) => {
      if (!Number.isFinite(ms)) return '—';
      const shifted = new Date(ms + offsetMinutes * 60_000);
      return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
    };
    const relative = (ms, t) => {
      if (!Number.isFinite(ms)) return '—';
      const delta = Date.now() - ms;
      if (delta < 60_000) return t('agoNow');
      if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}${t('agoMinutes')}`;
      if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}${t('agoHours')}`;
      if (delta < 30 * 86_400_000) return `${Math.floor(delta / 86_400_000)}${t('agoDays')}`;
      return timeLabel(ms, -new Date().getTimezoneOffset()).slice(0, 10);
    };
    //#endregion

    //#region data helpers
    const EMPTY_REPORT = {
      generatedAt: 0,
      offsetMinutes: -new Date().getTimezoneOffset(),
      totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, sessions: 0, live: 0, turns: 0, steps: 0 },
      sessions: [],
      models: [],
      days: [],
      hours: [],
      cwds: [],
      errors: [],
    };

    /**
     * Order rows parent-first so delegated children sit under their parent.
     * Each row also carries what the flat table cannot show: the session's own
     * spend, and how much of its subtree the delegated children account for.
     */
    function buildForest(sessions) {
      const byId = new Map(sessions.map((session) => [session.id, session]));
      const children = new Map();
      const roots = [];
      for (const session of sessions) {
        const parent = session.parentSession;
        if (typeof parent === 'string' && byId.has(parent)) {
          const bucket = children.get(parent);
          if (bucket === undefined) children.set(parent, [session]);
          else bucket.push(session);
        } else {
          roots.push(session);
        }
      }
      const spend = (session) => session.totals?.total ?? 0;
      const sortRows = (rows) => rows.sort((left, right) => spend(right) - spend(left));
      sortRows(roots);
      for (const bucket of children.values()) sortRows(bucket);
      const rows = [];
      const visit = (session, depth) => {
        const kids = children.get(session.id) ?? [];
        const childTotal = kids.reduce((sum, child) => sum + spend(child), 0);
        rows.push({ session, depth, own: spend(session) - childTotal, childTotal, children: kids.length });
        for (const child of kids) visit(child, depth + 1);
      };
      for (const root of roots) visit(root, 0);
      // Sessions whose parent is outside the visible corpus still belong in the list.
      const seen = new Set(rows.map((row) => row.session.id));
      for (const session of sortRows(sessions.filter((entry) => !seen.has(entry.id)))) {
        rows.push({ session, depth: 0, own: spend(session), childTotal: 0, children: 0 });
      }
      return rows;
    }

    /** A session's model label: its dominant model, or the unknown marker. */
    function modelLabel(session, t) {
      const models = session.models ?? [];
      if (models.length === 0) return t('unknownModel');
      const top = models.reduce((best, model) => (model.total > best.total ? model : best), models[0]);
      return top.model;
    }

    function stackTotals(day) {
      return day.input + day.output + day.cacheRead + day.cacheWrite;
    }

    /** The window the headline numbers cover, so they are never read as all-time. */
    function rangeNote(report, t) {
      if (!report.rangeDays) return t('rangeAll');
      const days = report.days ?? [];
      if (days.length === 0) return `${report.rangeDays}${t('rangeUnit')}`;
      return `${dayLabel(days[0].day)} – ${dayLabel(days[days.length - 1].day)}`;
    }

    /** Disclosure for a truncated list, so a hidden remainder never reads as missing data. */
    function truncNote(t, count, total) {
      return t('truncatedNote').replace('{n}', String(count)).replace('{tokens}', compact(total));
    }

    /** Session rows as CSV, for a spreadsheet or a second look in another tool. */
    function exportCsv(sessions, report, t) {
      const header = ['session', 'title', 'cwd', 'parent', 'models', 'turns', 'input', 'output', 'cacheRead', 'cacheWrite', 'total', 'firstSeen', 'lastSeen'];
      const escape = (value) => {
        const text = String(value ?? '');
        return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      };
      const lines = [header.join(',')];
      for (const session of sessions) {
        lines.push([
          session.id,
          session.title,
          session.cwd,
          session.parentSession ?? '',
          (session.models ?? []).map((model) => `${model.provider}/${model.model}`).join(' '),
          session.turns,
          session.totals?.input ?? 0,
          session.totals?.output ?? 0,
          session.totals?.cacheRead ?? 0,
          session.totals?.cacheWrite ?? 0,
          session.totals?.total ?? 0,
          timeLabel(session.firstTime, report.offsetMinutes),
          timeLabel(session.lastTime, report.offsetMinutes),
        ].map(escape).join(','));
      }
      const blob = new Blob([`\ufeff${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `token-usage-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    }
    //#endregion

    //#region primitives
    /**
     * Chart tooltip. The wrapper owns pointer tracking; chart marks call
     * `show(text)` on enter and `hide()` on leave, so no mark has to know where
     * the cursor is.
     */
    function Tooltip({ children }) {
      const [tip, setTip] = React.useState(null);
      const [at, setAt] = React.useState({ x: 0, y: 0 });
      const show = React.useCallback((text) => setTip(text), []);
      const hide = React.useCallback(() => setTip(null), []);
      return h(
        'div',
        {
          onMouseMove: (event) => setAt({ x: event.clientX, y: event.clientY }),
          onMouseLeave: hide,
          style: { position: 'relative' },
        },
        children({ show, hide }),
        tip === null
          ? null
          : h('div', { className: 'tbi-tooltip', style: { left: `${at.x}px`, top: `${at.y - 12}px` } }, tip),
      );
    }

    function Figure({ label, value, unit, note }) {
      return h(
        'div',
        { className: 'tbi-figure' },
        h('div', { className: 'tbi-figureLabel' }, label),
        h('div', { className: 'tbi-figureValue' }, value, unit === undefined ? null : h('span', { className: 'tbi-figureUnit' }, unit)),
        note === undefined ? null : h('div', { className: 'tbi-figureNote' }, note),
      );
    }

    function Legend({ t }) {
      return h(
        'div',
        { className: 'tbi-legend' },
        h('span', { className: 'tbi-legendItem' }, h('i', { className: 'tbi-swatch', style: { background: 'var(--tbi-fill-input)' } }), t('legendInput')),
        h('span', { className: 'tbi-legendItem' }, h('i', { className: 'tbi-swatch', style: { background: 'var(--tbi-fill-output)' } }), t('legendOutput')),
        h('span', { className: 'tbi-legendItem' }, h('i', { className: 'tbi-swatch', style: { background: 'var(--tbi-fill-cache-read)' } }), t('legendCacheRead')),
        h('span', { className: 'tbi-legendItem' }, h('i', { className: 'tbi-swatch', style: { background: 'var(--tbi-fill-cache-write)' } }), t('legendCacheWrite')),
      );
    }

    function Card({ title, hint, aside, children }) {
      return h(
        'section',
        { className: 'tbi-card' },
        h(
          'div',
          { className: 'tbi-cardHead' },
          h('div', null, h('h2', { className: 'tbi-cardTitle' }, title), hint === undefined ? null : h('p', { className: 'tbi-cardHint' }, hint)),
          aside ?? null,
        ),
        children,
      );
    }
    //#endregion

    //#region charts
    /**
     * Daily stacked columns. One column per day, four stacked segments, a
     * hairline grid and value labels only on the tallest three columns so the
     * axis does not become a wall of numbers.
     */
    function DailyChart({ days, t }) {
      const width = 960;
      const height = 200;
      const padding = { top: 12, right: 8, bottom: 22, left: 44 };
      const innerW = width - padding.left - padding.right;
      const innerH = height - padding.top - padding.bottom;
      const rows = days.slice(-30);
      const max = Math.max(1, ...rows.map(stackTotals));
      const slot = innerW / Math.max(1, rows.length);
      const barW = Math.max(3, Math.min(28, slot - 4));
      const ticks = [0, 0.5, 1].map((fraction) => Math.round(max * fraction));
      const topValues = new Set(
        [...rows]
          .map((row, index) => ({ index, value: stackTotals(row) }))
          .sort((left, right) => right.value - left.value)
          .slice(0, 3)
          .map((entry) => entry.index),
      );
      return h(
        Tooltip,
        null,
        ({ show, hide }) =>
          h(
            'svg',
            { className: 'tbi-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('dailyTitle') },
            ticks.map((tick) =>
              h(
                'g',
                { key: tick },
                h('line', {
                  className: 'tbi-grid',
                  x1: padding.left,
                  x2: width - padding.right,
                  y1: padding.top + innerH - (tick / max) * innerH,
                  y2: padding.top + innerH - (tick / max) * innerH,
                }),
                h(
                  'text',
                  { className: 'tbi-axis', x: padding.left - 8, y: padding.top + innerH - (tick / max) * innerH + 3, textAnchor: 'end' },
                  compact(tick),
                ),
              ),
            ),
            rows.map((row, index) => {
              const x = padding.left + index * slot + (slot - barW) / 2;
              const segments = [
                ['input', 'var(--tbi-fill-input)'],
                ['cacheRead', 'var(--tbi-fill-cache-read)'],
                ['cacheWrite', 'var(--tbi-fill-cache-write)'],
                ['output', 'var(--tbi-fill-output)'],
              ];
              let cursor = padding.top + innerH;
              const pieces = [];
              for (const [key, fill] of segments) {
                const value = row[key] ?? 0;
                if (value <= 0) continue;
                const segH = (value / max) * innerH;
                cursor -= segH;
                pieces.push(h('rect', { key, x, y: cursor, width: barW, height: Math.max(0.6, segH), fill }));
              }
              const total = stackTotals(row);
              return h(
                'g',
                { key: row.day, className: 'tbi-col' },
                h('rect', {
                  x: padding.left + index * slot,
                  y: padding.top,
                  width: slot,
                  height: innerH,
                  fill: 'transparent',
                  onMouseEnter: () =>
                    show(
                      `${row.day}  ${compact(total)} tokens\n${t('legendInput')} ${exact(row.input)} · ${t('legendOutput')} ${exact(row.output)}\n${t('legendCacheRead')} ${exact(row.cacheRead)} · ${t('legendCacheWrite')} ${exact(row.cacheWrite)}\n${row.sessions} ${t('sessionsUnit')}`,
                    ),
                  onMouseLeave: hide,
                }),
                pieces,
                topValues.has(index) && total > 0
                  ? h(
                      'text',
                      { className: 'tbi-axis', x: x + barW / 2, y: padding.top + innerH - (total / max) * innerH - 5, textAnchor: 'middle' },
                      compact(total),
                    )
                  : null,
                rows.length <= 20 || index % Math.ceil(rows.length / 12) === 0
                  ? h(
                      'text',
                      { className: 'tbi-axis', x: x + barW / 2, y: height - 6, textAnchor: 'middle' },
                      dayLabel(row.day),
                    )
                  : null,
              );
            }),
          ),
      );
    }

    /** Hourly area line over the last week. */
    function HourlyChart({ hours, t, offsetMinutes }) {
      const width = 960;
      const height = 130;
      const padding = { top: 10, right: 8, bottom: 20, left: 44 };
      const innerW = width - padding.left - padding.right;
      const innerH = height - padding.top - padding.bottom;
      const rows = hours.slice(-24 * 7);
      if (rows.length === 0) return h('p', { className: 'tbi-weak' }, t('empty'));
      const max = Math.max(1, ...rows.map((row) => row.total));
      const stepX = innerW / Math.max(1, rows.length - 1);
      const point = (row, index) => {
        const x = padding.left + index * stepX;
        const y = padding.top + innerH - (row.total / max) * innerH;
        return [x, y];
      };
      const line = rows.map((row, index) => point(row, index).join(',')).join(' ');
      const area = `${padding.left},${padding.top + innerH} ${line} ${padding.left + (rows.length - 1) * stepX},${padding.top + innerH}`;
      const hourOf = (hour) => `${hour.slice(5, 7)}/${hour.slice(8, 10)} ${hour.slice(11, 13)}:00`;
      return h(
        Tooltip,
        null,
        ({ show, hide }) =>
          h(
            'svg',
            { className: 'tbi-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('hourlyTitle') },
            h('line', {
              className: 'tbi-grid',
              x1: padding.left,
              x2: width - padding.right,
              y1: padding.top + innerH,
              y2: padding.top + innerH,
            }),
            h('polygon', { points: area, fill: 'color-mix(in srgb, var(--tbi-fill-input) 16%, transparent)' }),
            h('polyline', { points: line, fill: 'none', stroke: 'var(--tbi-fill-input)', strokeWidth: 1.5, strokeLinejoin: 'round' }),
            rows.map((row, index) => {
              const [x, y] = point(row, index);
              return h('circle', {
                key: row.hour,
                cx: x,
                cy: y,
                r: 5,
                fill: 'transparent',
                onMouseEnter: () =>
                  show(
                    `${hourOf(row.hour)}  ${compact(row.total)} tokens\n${t('legendInput')} ${exact(row.input)} · ${t('legendOutput')} ${exact(row.output)}\n${t('legendCacheRead')} ${exact(row.cacheRead)}`,
                  ),
                onMouseLeave: hide,
              });
            }),
            h('text', { className: 'tbi-axis', x: padding.left - 8, y: padding.top + 8, textAnchor: 'end' }, compact(max)),
            h('text', { className: 'tbi-axis', x: padding.left - 8, y: padding.top + innerH + 3, textAnchor: 'end' }, '0'),
            rows.length > 1
              ? h(
                  'text',
                  { className: 'tbi-axis', x: width - padding.right, y: height - 4, textAnchor: 'end' },
                  hourOf(rows[rows.length - 1].hour),
                )
              : null,
            rows.length > 1
              ? h('text', { className: 'tbi-axis', x: padding.left, y: height - 4, textAnchor: 'start' }, hourOf(rows[0].hour))
              : null,
          ),
      );
    }

    /** One horizontal bar row: name, proportional fill, value. */
    function BarRow({ name, note, value, max }) {
      const width = max > 0 ? Math.max(1.5, (value / max) * 100) : 0;
      return h(
        'div',
        { className: 'tbi-barRow' },
        h('span', { className: 'tbi-barName', title: name }, name, note === undefined ? null : h('small', null, note)),
        h('div', { className: 'tbi-barTrack' }, h('div', { className: 'tbi-barFill', style: { width: `${width}%` } })),
        h('span', { className: 'tbi-barValue' }, compact(value)),
      );
    }

    /** Turn-level bars inside an expanded session row. */
    function TurnSpark({ rows, t, offsetMinutes }) {
      if (rows.length === 0) return h('p', { className: 'tbi-weak' }, t('detailNoRows'));
      const max = Math.max(1, ...rows.map((row) => row.total));
      const shown = rows.length > 60 ? rows.slice(-60) : rows;
      return h(
        'div',
        { className: 'tbi-turnList' },
        h(
          'div',
          { className: 'tbi-turnHeader' },
          h('span', null, t('detailStep')),
          h('span', null, t('detailModel')),
          h('span', null, t('detailTime')),
          h('span', null, t('detailTokens')),
          h('span', { style: { textAlign: 'right' } }, t('totalTokens')),
        ),
        shown.map((row) => {
          const modelText = row.provider ? `${row.provider}/${row.model}` : row.model || t('unknownModel');
          const timeText = exactTime(row.time, offsetMinutes);
          const tooltip = `${row.day} ${timeText}\n${modelText}\n${t('legendInput')} ${exact(row.input)} · ${t('legendOutput')} ${exact(row.output)}\n${t('legendCacheRead')} ${exact(row.cacheRead)} · ${t('legendCacheWrite')} ${exact(row.cacheWrite)}\n${t('totalTokens')} ${exact(row.total)}`;
          return h(
            'div',
            { className: 'tbi-turnRow', key: `${row.turn}:${row.step}`, title: tooltip },
            h('span', { className: 'tbi-turnLabel' }, `T${row.turn} · S${row.step}`),
            h('span', { className: 'tbi-turnModel', title: modelText }, modelText),
            h('span', { className: 'tbi-turnTime' }, timeText),
            h(
              'span',
              { className: 'tbi-turnBar' },
              h('i', { className: 'tbi-turnSeg', style: { width: `${(row.input / max) * 100}%`, background: 'var(--tbi-fill-input)' } }),
              h('i', { className: 'tbi-turnSeg', style: { width: `${(row.cacheRead / max) * 100}%`, background: 'var(--tbi-fill-cache-read)' } }),
              h('i', { className: 'tbi-turnSeg', style: { width: `${(row.output / max) * 100}%`, background: 'var(--tbi-fill-output)' } }),
            ),
            h('span', { className: 'tbi-turnTotal' }, compact(row.total)),
          );
        }),
      );
    }
    //#endregion

    //#region page
    function TokenBiPage(props) {
      const { t } = props;
      const [report, setReport] = React.useState(EMPTY_REPORT);
      const [status, setStatus] = React.useState('loading');
      const [error, setError] = React.useState(null);
      const [filter, setFilter] = React.useState('all');
      const [range, setRange] = React.useState(RANGES[1]);
      const [expanded, setExpanded] = React.useState(() => new Set());
      const [details, setDetails] = React.useState({});
      const offsetMinutes = React.useMemo(() => -new Date().getTimezoneOffset(), []);

      const load = React.useCallback(
        async (force, days) => {
          setStatus((current) => (current === 'ready' ? 'refreshing' : 'loading'));
          try {
            const query = `offset=${offsetMinutes}&days=${days ?? range}`;
            const response = await fetch(`${API}/report?${query}${force ? '&refresh=1' : ''}`, {
              credentials: 'same-origin',
            });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const next = await response.json();
            setReport(next);
            setError(next.errors?.length > 0 ? next.errors[0].message : null);
            setStatus('ready');
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
            setStatus('ready');
          }
        },
        [offsetMinutes, range],
      );

      React.useEffect(() => {
        let alive = true;
        load(false);
        const timer = window.setInterval(() => {
          if (alive && document.visibilityState === 'visible') load(true);
        }, 60_000);
        return () => {
          alive = false;
          window.clearInterval(timer);
        };
      }, [load]);

      const changeRange = React.useCallback(
        (days) => {
          setRange(days);
          setExpanded(new Set());
          setDetails({});
          load(false, days);
        },
        [load],
      );

      const toggle = React.useCallback(
        (sessionId) => {
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(sessionId)) next.delete(sessionId);
            else next.add(sessionId);
            return next;
          });
          setDetails((current) => {
            if (current[sessionId] !== undefined) return current;
            fetch(`${API}/session?id=${encodeURIComponent(sessionId)}&offset=${offsetMinutes}`, { credentials: 'same-origin' })
              .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
              .then((detail) => setDetails((rows) => ({ ...rows, [sessionId]: detail })))
              .catch(() => setDetails((rows) => ({ ...rows, [sessionId]: { rows: [] } })));
            return { ...current, [sessionId]: null };
          });
        },
        [offsetMinutes],
      );

      const sessions = React.useMemo(() => {
        const rows = report.sessions ?? [];
        if (filter === 'live') return rows.filter((row) => row.live);
        if (filter === 'cold') return rows.filter((row) => !row.live);
        return rows;
      }, [report.sessions, filter]);

      const forest = React.useMemo(() => buildForest(sessions), [sessions]);
      const totals = report.totals ?? EMPTY_REPORT.totals;
      const cacheShare = percent(totals.cacheRead, totals.total);
      const today = React.useMemo(() => {
        const now = new Date(Date.now() + offsetMinutes * 60_000);
        const key = now.toISOString().slice(0, 10);
        return (report.days ?? []).find((day) => day.day === key);
      }, [report.days, offsetMinutes]);

      const maxModel = Math.max(1, ...(report.models ?? []).map((model) => model.total));
      const maxCwd = Math.max(1, ...(report.cwds ?? []).map((cwd) => cwd.total));
      const maxTree = Math.max(1, ...sessions.map((session) => session.totals?.total ?? 0));

      if (status === 'loading' && (report.sessions ?? []).length === 0) {
        return h('div', { className: 'tbi-root' }, h('div', { className: 'tbi-scroll' }, h('div', { className: 'tbi-inner' }, h('p', { className: 'tbi-weak', style: { paddingTop: 40 } }, t('loading')))));
      }

      return h(
        'div',
        { className: 'tbi-root' },
        h(
          'div',
          { className: 'tbi-scroll' },
          h(
            'div',
            { className: 'tbi-inner' },
            h(
              'header',
              { className: 'tbi-head' },
              h(
                'div',
                { className: 'tbi-headText' },
                h('h1', { className: 'tbi-title' }, t('title')),
                h('p', { className: 'tbi-sub' }, t('subtitle')),
              ),
              h(
                'div',
                { className: 'tbi-tools' },
                h(
                  'div',
                  { className: 'tbi-seg', role: 'group', 'aria-label': t('rangeLabel') },
                  RANGES.map((days) =>
                    h(
                      'button',
                      {
                        key: days,
                        type: 'button',
                        className: 'tbi-segBtn',
                        'data-active': range === days,
                        'aria-pressed': range === days,
                        onClick: () => changeRange(days),
                      },
                      days === 0 ? t('rangeAll') : `${days}${t('rangeUnit')}`,
                    ),
                  ),
                ),
                h(
                  'button',
                  { type: 'button', className: 'tbi-btn', onClick: () => load(true), disabled: status === 'refreshing' },
                  status === 'refreshing' ? t('refreshing') : t('refresh'),
                ),
                h('button', { type: 'button', className: 'tbi-btn', onClick: () => exportCsv(sessions, report, t) }, t('exportCsv')),
              ),
            ),

            error === null ? null : h('p', { className: 'tbi-error' }, `${t('error')}: ${error}`),

            (report.sessions ?? []).length === 0
              ? h(
                  'div',
                  { className: 'tbi-card' },
                  h(
                    'div',
                    { className: 'tbi-empty' },
                    h('div', { className: 'tbi-emptyTitle' }, t('empty')),
                    h('div', null, t('emptyHint')),
                  ),
                )
              : h(
                  React.Fragment,
                  null,

                  h(
                    'div',
                    { className: 'tbi-figures' },
                    h(Figure, { label: t('totalTokens'), value: compact(totals.total), unit: t('tokensShort'), note: rangeNote(report, t) }),
                    h(Figure, { label: t('todayTokens'), value: compact(today?.total ?? 0), unit: t('tokensShort') }),
                    h(Figure, { label: t('totalSessions'), value: String(totals.sessions), unit: t('sessionsUnit'), note: `${totals.live} ${t('live')}` }),
                    h(Figure, { label: t('totalTurns'), value: String(totals.turns), unit: t('turnsUnit') }),
                    h(Figure, { label: t('cacheShare'), value: cacheShare, note: `${compact(totals.cacheRead)} / ${compact(totals.total)}` }),
                  ),

                  h(
                    Card,
                    { title: t('dailyTitle'), hint: t('dailyHint'), aside: h(Legend, { t }) },
                    h(DailyChart, { days: report.days ?? [], t, offsetMinutes }),
                  ),

                  h(Card, { title: t('hourlyTitle'), hint: t('hourlyHint') }, h(HourlyChart, { hours: report.hours ?? [], t, offsetMinutes })),

                  h(
                    'div',
                    { className: 'tbi-split' },
                    h(
                      Card,
                      { title: t('modelTitle') },
                      (report.models ?? []).length === 0
                        ? h('p', { className: 'tbi-weak' }, t('noModel'))
                        : (report.models ?? []).map((model) =>
                            h(BarRow, {
                              key: `${model.provider}/${model.model}`,
                              name: model.model,
                              note: `${model.provider} · ${percent(model.total, totals.total)}`,
                              value: model.total,
                              max: maxModel,
                            }),
                          ),
                    ),
                    h(
                      Card,
                      { title: t('cwdTitle') },
                      (report.cwds ?? []).length === 0
                        ? h('p', { className: 'tbi-weak' }, t('empty'))
                        : (report.cwds ?? []).slice(0, 8).map((cwd) =>
                            h(BarRow, {
                              key: cwd.cwd,
                              name: cwd.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/') || cwd.cwd,
                              note: `${cwd.sessions} ${t('sessionsUnit')}`,
                              value: cwd.total,
                              max: maxCwd,
                            }),
                          ),
                      (report.cwds ?? []).length > 8
                        ? h('p', { className: 'tbi-cardHint', style: { marginTop: 8 } }, truncNote(t, report.cwds.length - 8, report.cwds.slice(8).reduce((sum, cwd) => sum + cwd.total, 0)))
                        : null,
                    ),
                  ),

                  h(
                    Card,
                    {
                      title: t('sessionTitle'),
                      hint: t('sessionHint'),
                      aside: h(
                        'div',
                        { className: 'tbi-tools' },
                        ['all', 'live', 'cold'].map((key) =>
                          h(
                            'button',
                            {
                              key,
                              type: 'button',
                              className: 'tbi-btn',
                              'data-active': filter === key,
                              onClick: () => setFilter(key),
                            },
                            t(key === 'all' ? 'filterAll' : key === 'live' ? 'filterLive' : 'filterCold'),
                          ),
                        ),
                      ),
                    },
                    h(
                      'table',
                      { className: 'tbi-table' },
                      h(
                        'thead',
                        null,
                        h(
                          'tr',
                          null,
                          h('th', null, t('columnSession')),
                          h('th', { 'data-align': 'right' }, t('columnTokens')),
                          h('th', { 'data-align': 'right' }, t('columnTurns')),
                          h('th', { 'data-align': 'right' }, t('columnCache')),
                          h('th', null, t('columnModel')),
                          h('th', { 'data-align': 'right' }, t('columnLast')),
                        ),
                      ),
                      h(
                        'tbody',
                        null,
                        forest.length === 0
                          ? h('tr', null, h('td', { colSpan: 6, className: 'tbi-weak' }, t('empty')))
                          : forest.map(({ session, depth }) => {
                              const open = expanded.has(session.id);
                              const detail = details[session.id];
                              const total = session.totals?.total ?? 0;
                              return h(
                                React.Fragment,
                                { key: session.id },
                                h(
                                  'tr',
                                  { 'data-clickable': 'true', onClick: () => toggle(session.id) },
                                  h(
                                    'td',
                                    null,
                                    h(
                                      'div',
                                      { className: 'tbi-sessionName' },
                                      h(
                                        'svg',
                                        {
                                          className: 'tbi-caret',
                                          'data-open': open,
                                          viewBox: '0 0 12 12',
                                          width: 12,
                                          height: 12,
                                          'aria-hidden': 'true',
                                        },
                                        h('path', { d: 'M4 2.5 8 6l-4 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
                                      ),
                                      depth > 0
                                        ? h('span', { className: 'tbi-treeBranch', title: t('subagent') }, `${'│  '.repeat(Math.max(0, depth - 1))}└`)
                                        : null,
                                      h('span', { className: 'tbi-sessionTitle', title: session.title }, session.title),
                                      session.live ? h('span', { className: 'tbi-pill', 'data-live': true }, t('live')) : null,
                                      depth > 0 ? h('span', { className: 'tbi-pill', 'data-sub': true }, t('subagent')) : null,
                                    ),
                                  ),
                                  h('td', { 'data-align': 'right', className: 'tbi-num' }, compact(total)),
                                  h('td', { 'data-align': 'right', className: 'tbi-num' }, String(session.turns)),
                                  h('td', { 'data-align': 'right', className: 'tbi-num tbi-weak' }, percent(session.totals?.cacheRead ?? 0, total)),
                                  h('td', { className: 'tbi-weak' }, modelLabel(session, t)),
                                  h('td', { 'data-align': 'right', className: 'tbi-weak' }, relative(session.lastTime, t)),
                                ),
                                open
                                  ? h(
                                      'tr',
                                      { className: 'tbi-detailRow' },
                                      h(
                                        'td',
                                        { colSpan: 6 },
                                        h(
                                          'div',
                                          { className: 'tbi-detail' },
                                          detail === undefined || detail === null
                                            ? h('p', { className: 'tbi-weak' }, t('loading'))
                                            : h(TurnSpark, { rows: detail.rows ?? [], t, offsetMinutes }),
                                        ),
                                      ),
                                    )
                                  : null,
                              );
                            }),
                      ),
                    ),
                  ),

                  h(
                    Card,
                    { title: t('treeTitle'), hint: t('treeHint') },
                    h(
                      'div',
                      { className: 'tbi-tree' },
                      forest.map(({ session, depth, own, childTotal, children: kids }) =>
                        h(
                          'div',
                          { className: 'tbi-treeRow', key: session.id, 'data-depth': depth },
                          h(
                            'div',
                            { className: 'tbi-treeLabel' },
                            h('span', { className: 'tbi-treeBranch', 'aria-hidden': 'true' }, depth === 0 ? '●' : `${'│  '.repeat(Math.max(0, depth - 1))}└─`),
                            h('span', { className: 'tbi-treeName', title: session.title }, session.title),
                            kids > 0
                              ? h('span', { className: 'tbi-pill', 'data-sub': true }, `${kids} ${t('subagent')}`)
                              : null,
                          ),
                          h(
                            'div',
                            { className: 'tbi-treeBar' },
                            h(
                              'div',
                              { className: 'tbi-treeTrack', title: `${t('ownShare')} ${compact(own)} · ${t('childShare')} ${compact(childTotal)}` },
                              h('div', { className: 'tbi-treeFill', style: { width: `${(own / maxTree) * 100}%` } }),
                              h('div', { className: 'tbi-treeFillChild', style: { width: `${(childTotal / maxTree) * 100}%` } }),
                            ),
                            h('span', { className: 'tbi-barValue' }, compact(session.totals?.total ?? 0)),
                          ),
                        ),
                      ),
                    ),
                  ),

                  h(
                    'div',
                    { className: 'tbi-foot' },
                    h('span', null, `${t('generatedAt')} ${timeLabel(report.generatedAt, offsetMinutes)}`),
                    h('span', null, `${(report.days ?? []).length} ${t('columnLast')}`),
                  ),
                ),
          ),
        ),
      );
    }
    //#endregion

    //#region panel registration
    function PanelIcon({ size, active }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: { display: 'block' } },
        h('path', {
          d: 'M2.5 13.5V9M6.5 13.5V5.5M10.5 13.5V7.5M14 13.5V3',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 1.8 : 1.5,
          strokeLinecap: 'round',
        }),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        breadcrumb('apply');
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'token-bi: dictionaries');
        const t = ctx.locale.bind(NS);
        ctx.effect(() => {
          if (typeof document === 'undefined') return () => {};
          const tag = document.createElement('style');
          tag.dataset.plugin = 'dsh-token-bi';
          tag.dataset.pluginCss = 'dsh-token-bi/page.css';
          tag.textContent = CSS;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'token-bi: styles');
        ctx.slots.inject('main', () => {
          breadcrumb('slot:main');
          return ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, TokenBiPage);
        });
        ctx.slots.inject('sidebar.panellist', () => {
          breadcrumb('slot:sidebar.panellist');
          return ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 5, label: () => t('panel'), locale: NS }, PanelIcon);
        });
        // No Settings page: the report has nothing to configure, so a settings
        // section would only duplicate the sidebar entry.
      },
    };
    //#endregion
  },
});
