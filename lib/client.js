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
      'dayTokens': '当日 token',
      'pageUnit': '条',
      'totalSessions': '会话',
      'totalTurns': '轮次',
      'cacheShare': '缓存命中占比',
      'todayTokens': '今日消耗',
      'dailyTitle': '每日消耗',
      'dailyHint': '按日堆叠：输入 / 输出 / 缓存读 / 缓存写',
      'modelTitle': '模型分布',
      'cwdTitle': '工作区分布',
      'sessionTitle': '会话明细',
      'sessionHint': '点击任意一行展开逐轮时间线；子代理默认折叠在父会话下',
      'treeTitle': '调用树',
      'treeHint': '每个会话自己的消耗，与它派生的子会话所占的份额；点「N 子代理」可折叠该分支',
      'ownShare': '自身',
      'childShare': '子会话',
      'timelineTitle': '轮次时间线',
      'columnSession': '会话',
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
      'detailNoDayRows': '所选日期该会话没有记录：',
      'close': '关闭',
      'live': '进行中',
      'stale': '历史',
      'sessionsUnit': '个会话',
      'turnsUnit': '轮',
      'noModel': '未记录模型',
      'modelHint': '仅统计有 token 的模型',
      'toolCallsTitle': '官方工具调用（按次计费）',
      'toolFetch': '网页抓取 web_fetch',
      'toolSearch': '联网搜索 web_search',
      'toolCallsHint': '这部分按请求次数收费，不产生 token',
      'callsUnit': '次',
      'subagent': '子代理',
      'foldHint': '收起列表',
      'unfoldHint': '展开全部',
      'aggregateHint': '聚合路由：按积分临期在多个真实渠道之间自动切换，历史用量不区分具体渠道',
      'foldChildren': '折叠子代理',
      'unfoldChildren': '展开子代理',
      'foldAll': '折叠全部子代理',
      'unfoldAll': '展开全部子代理',
      'foldAllHint': '把所有子代理折叠进各自的父会话',
      'unfoldAllHint': '把所有子代理展开成独立行',
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
      'filterAll': '全部',
      'filterLive': '进行中',
      'filterCold': '历史',
      'unknownModel': '未记录',
      'generatedAt': '汇总于',
      'snapshotAt': '上次汇总于',
      'detailStep': '步',
      'detailModel': '调用模型',
      'detailTime': '时刻',
      'detailTokens': '消耗',
      'kindSearch': '联网搜索',
      'kindTitle': '标题生成',
      'estimated': '估算',
      'showAllSteps': '显示全部 {count} 步',
      'showRecentSteps': '仅显示最近 60 步',
      'filterModelAll': '全部',
      'filterOnlySearch': '仅看搜索',
      'searchCallNotice': '本会话包含 {count} 次后台联网搜索 (HTTP 请求)，调用了 DeepSeek 官方模型',
      'activeFilters': '当前筛选',
      'filterDay': '日期',
      'filterModel': '模型',
      'filterCwd': '工作区',
      'clearAllFilters': '清除全部筛选',
      'clickToFilter': '点击联动筛选',
      'locateSession': '点击定位至会话明细并展开',
      'viewBar': '柱状图',
      'viewTrend': '趋势图',
      'viewCumulative': '累积图',
      'trendHint': '每日消耗波峰波谷走势，悬停看明细，点击联动切片',
      'cumulativeHint': '周期内 Token 累计总花销攀升轨迹',
      'cumTotal': '累计总消耗',
      'dayAdded': '当日新增',
      'viewHeatmap': '日历热力',
      'heatmapTitle': '年度活跃日历',
      'heatmapHint': '最近 365 天（一年）每日 Token 消耗全景，不受时间窗口限制，点击方块联动筛选',
      'heatLess': '少',
      'heatMore': '多',
      'noSpend': '无消耗',
      'dayMon': '一',
      'dayWed': '三',
      'dayFri': '五',
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
      'dayTokens': 'That day',
      'pageUnit': 'per page',
      'totalSessions': 'Sessions',
      'totalTurns': 'Turns',
      'cacheShare': 'Cache hit share',
      'todayTokens': 'Today',
      'dailyTitle': 'Daily spend',
      'dailyHint': 'Stacked per day: input / output / cache read / cache write',
      'modelTitle': 'By model',
      'cwdTitle': 'By workspace',
      'sessionTitle': 'Sessions',
      'sessionHint': 'Click a row to expand its per-turn timeline; subagents stay folded under their parent',
      'treeTitle': 'Call tree',
      'treeHint': 'What each session spent itself, and the share its delegated children took; click the subagent pill to fold a branch',
      'ownShare': 'Own',
      'childShare': 'Children',
      'timelineTitle': 'Turn timeline',
      'columnSession': 'Session',
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
      'detailNoDayRows': 'No turns on the selected day for this session:',
      'close': 'Close',
      'live': 'Live',
      'stale': 'Archived',
      'sessionsUnit': 'sessions',
      'turnsUnit': 'turns',
      'noModel': 'No model recorded',
      'modelHint': 'Models with token usage only',
      'toolCallsTitle': 'Official tool calls (billed per request)',
      'toolFetch': 'Web fetch',
      'toolSearch': 'Web search',
      'toolCallsHint': 'Charged per request; these consume no tokens',
      'callsUnit': 'calls',
      'subagent': 'Subagent',
      'foldHint': 'Collapse',
      'unfoldHint': 'Show all',
      'aggregateHint': 'Aggregate route: switches between real channels by credit expiry; history is not split by channel',
      'foldChildren': 'Fold subagents',
      'unfoldChildren': 'Unfold subagents',
      'foldAll': 'Fold all subagents',
      'unfoldAll': 'Unfold all subagents',
      'foldAllHint': 'Fold every subagent under its parent session',
      'unfoldAllHint': 'Show every subagent as its own row',
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
      'filterAll': 'All',
      'filterLive': 'Live',
      'filterCold': 'Archived',
      'unknownModel': 'Not recorded',
      'generatedAt': 'Aggregated',
      'snapshotAt': 'Last aggregated',
      'detailStep': 'Step',
      'detailModel': 'Model',
      'detailTime': 'Timestamp',
      'detailTokens': 'Usage',
      'kindSearch': 'Search',
      'kindTitle': 'Title',
      'estimated': 'est.',
      'showAllSteps': 'Show all {count} steps',
      'showRecentSteps': 'Show latest 60 only',
      'filterModelAll': 'All',
      'filterOnlySearch': 'Search only',
      'searchCallNotice': 'Includes {count} web-search HTTP requests calling official DeepSeek models',
      'activeFilters': 'Active filters',
      'filterDay': 'Day',
      'filterModel': 'Model',
      'filterCwd': 'Workspace',
      'clearAllFilters': 'Clear all',
      'clickToFilter': 'Click to filter',
      'locateSession': 'Click to locate and expand in table',
      'viewBar': 'Bar',
      'viewTrend': 'Trend',
      'viewCumulative': 'Cumulative',
      'trendHint': 'Daily spend peaks and valleys trend, hover for detail, click to filter',
      'cumulativeHint': 'Cumulative token spend trajectory over the period',
      'cumTotal': 'Cumulative total',
      'dayAdded': 'Added today',
      'viewHeatmap': 'Heatmap',
      'heatmapTitle': 'Annual activity calendar',
      'heatmapHint': 'Full-year (365 days) daily token spend intensity, independent of window presets, click cell to filter',
      'heatLess': 'Less',
      'heatMore': 'More',
      'noSpend': 'No spend',
      'dayMon': 'Mon',
      'dayWed': 'Wed',
      'dayFri': 'Fri',
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
.tbi-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l3)}
.tbi-segBtn{height:24px;padding:0 10px;border:none;border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;font-weight:500;cursor:pointer;white-space:nowrap;transition:all 0.15s ease}
.tbi-segBtn:hover{color:var(--dsw-alias-label-primary)}
.tbi-segBtn[data-active=true]{background:var(--dsw-alias-state-business-primary);color:#fff;font-weight:600}
.tbi-figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;background:var(--dsw-alias-border-l2);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);overflow:hidden}
.tbi-figure{background:var(--dsw-alias-bg-layer-1);padding:14px 16px 16px}
.tbi-figureLabel{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.tbi-figureValue{margin-top:6px;font-size:24px;line-height:32px;font-weight:500;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.tbi-figureUnit{margin-left:4px;font-size:12px;font-weight:400;color:var(--dsw-alias-label-tertiary)}
.tbi-figureNote{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
/* The exact count under a headline figure: quiet, monospace, and selectable so
   it can be copied straight into a report. "user-select: all" makes one click
   take the whole number instead of a stray digit. */
.tbi-figureExact{margin-top:3px;color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code);font-size:11px;line-height:15px;font-variant-numeric:tabular-nums;letter-spacing:.02em;cursor:text;user-select:all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tbi-figureExact:hover{color:var(--dsw-alias-label-secondary)}
.tbi-card{border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);padding:16px}
.tbi-cardHead{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px}
.tbi-viewTabs{display:inline-flex;align-items:center;padding:2px;background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l3);gap:2px}
.tbi-viewBtn{border:none;background:transparent;padding:2px 8px;border-radius:var(--dsw-radius-xs);font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);cursor:pointer;display:inline-flex;align-items:center;gap:4px;line-height:16px;transition:all 0.15s ease}
.tbi-viewBtn:hover{color:var(--dsw-alias-label-primary)}
.tbi-viewBtn[data-active=true]{background:var(--dsw-alias-state-business-primary);color:#fff;font-weight:600}
.tbi-cardTitle{margin:0;font-size:14px;font-weight:500;line-height:22px}
.tbi-cardHint{margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.tbi-legend{display:flex;flex-wrap:wrap;gap:12px;color:var(--dsw-alias-label-secondary);font-size:11px}
.tbi-legendItem{display:inline-flex;align-items:center;gap:5px}
/* The model legend is a row of switches: clicking one isolates that series in
   the stacked chart, which is how a fourteen-slice column stays readable. */
.tbi-modelLegend{align-items:center;gap:10px}
button.tbi-legendItem{font:inherit;color:inherit;background:none;border:0;padding:1px 3px;border-radius:var(--dsw-radius-xs);cursor:pointer;transition:opacity .15s ease,background-color .15s ease}
button.tbi-legendItem:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
button.tbi-legendItem[data-focus=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
button.tbi-legendItem[data-muted=true]{opacity:.42}
.tbi-legendMore{color:var(--dsw-alias-label-tertiary)}
/* Swatch-only legend: the name is on hover, so a dozen models still fit in one
   quiet row instead of pushing the card head onto three lines. */
.tbi-swatchRow{display:flex;flex-wrap:wrap;align-items:center;gap:5px;max-width:340px}
.tbi-swatchBtn{width:14px;height:14px;padding:0;border:0;border-radius:3px;background:transparent;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:opacity .12s ease,transform .12s ease}
.tbi-swatchBtn > i{width:11px;height:11px;border-radius:2px;display:block;transition:transform .12s ease}
.tbi-swatchBtn:hover{transform:scale(1.25)}
.tbi-swatchBtn[data-focus=true]{box-shadow:0 0 0 1.5px var(--dsw-alias-label-primary)}
.tbi-swatchBtn[data-muted=true]{opacity:.3}
/* The hover shadow behind a column. It spans the full plot height so a day
   reads as "under the pointer" even when its bar is short. */
.tbi-colShadow{transition:fill .12s ease}
.tbi-col[data-hover=true] .tbi-colShadow{fill:color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent)}
.tbi-swatch{width:9px;height:9px;border-radius:2px;display:inline-block}
.tbi-chart{width:100%;display:block;overflow:visible}
.tbi-axis{fill:var(--dsw-alias-label-tertiary);font-size:10px}
.tbi-grid{stroke:var(--dsw-alias-border-l2);stroke-width:1;shape-rendering:crispEdges}
.tbi-col{transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.tbi-col:hover{opacity:.72}
.tbi-col{cursor:pointer;transition:opacity 0.2s ease}
.tbi-col[data-dimmed=true]{opacity:0.25}
.tbi-col[data-selected=true] rect{stroke:var(--dsw-alias-state-business-primary);stroke-width:1.5px}
.tbi-toolCalls{margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2);display:flex;flex-direction:column;gap:4px}
.tbi-toolCallsTitle{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-bottom:2px}
.tbi-toolCallRow{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:12px;cursor:pointer;border-radius:var(--dsw-radius-xs);padding:3px 6px;margin:0 -6px;transition:background 0.15s ease}
.tbi-toolCallRow:hover{background:var(--dsw-alias-bg-layer-2)}
.tbi-toolCallRow[data-dimmed=true]{opacity:0.3}
.tbi-toolCallRow[data-selected=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-left:3px solid var(--dsw-alias-state-business-primary);padding-left:3px}
.tbi-toolCallName{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tbi-toolCallCount{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);white-space:nowrap}
.tbi-toolCallsHint{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px}
.tbi-barRow{display:grid;grid-template-columns:minmax(90px,210px) 1fr auto;align-items:center;gap:12px;padding:5px 6px;margin:0 -6px;border-radius:var(--dsw-radius-xs);cursor:pointer;transition:all 0.15s ease}
.tbi-barRow:hover{background:var(--dsw-alias-bg-layer-2)}
.tbi-barRow[data-dimmed=true]{opacity:0.28}
.tbi-barRow[data-selected=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent);border-left:3px solid var(--dsw-alias-state-business-primary);padding-left:3px}
.tbi-treeRow{display:grid;grid-template-columns:1fr auto;align-items:center;gap:10px;padding:4px 6px;margin:0 -6px;border-radius:var(--dsw-radius-xs);cursor:pointer;transition:background 0.15s ease}
.tbi-treeRow:hover{background:var(--dsw-alias-bg-layer-2)}
.tbi-filterBar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-sm);margin-bottom:14px;border:1px solid var(--dsw-alias-border-l3);flex-wrap:wrap}
.tbi-filterBarLabel{font-size:11px;color:var(--dsw-alias-label-tertiary);font-weight:600}
.tbi-filterTag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:11px;background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-state-business-primary);font-weight:500}
.tbi-filterTagClose{cursor:pointer;border:none;background:none;color:inherit;font-size:12px;padding:0 2px;display:flex;align-items:center;line-height:1}
.tbi-filterClearBtn{border:none;background:none;color:var(--dsw-alias-label-secondary);font-size:11px;cursor:pointer;text-decoration:underline;margin-left:auto}
.tbi-filterClearBtn:hover{color:var(--dsw-alias-label-primary)}
.tbi-scroll{scroll-behavior:smooth}
.tbi-table tbody tr[data-focused=true] td{background-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent) !important;transition:background-color 0.3s ease}
.tbi-table tbody tr[data-focused=true] td:first-child{border-left:3px solid var(--dsw-alias-state-business-primary) !important}
.tbi-highlightRow td{animation:tbi-focus-pulse 2.2s cubic-bezier(0.16, 1, 0.3, 1) !important}
@keyframes tbi-focus-pulse{
  0%{background-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 36%, transparent) !important}
  40%{background-color:color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent) !important}
  100%{background-color:transparent !important}
}
.tbi-barName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:12px}
.tbi-barName small{color:var(--dsw-alias-label-tertiary);font-size:11px;margin-left:6px}
.tbi-barTrack{height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.tbi-barFill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary)}
.tbi-barValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.tbi-table{width:100%;border-collapse:collapse;font-size:12px;--tbi-cell-pad:10px}
/* Cap the tall panels so the cards below them stay reachable. The table needs
   this wrapper rather than its own overflow: a sticky header only sticks
   inside a scrolling ancestor. */
/* A sortable column head: clickable, and it shows which way the order runs.
   The caret is text rather than an icon so it inherits the header's type. */
.tbi-table th.tbi-sortable{cursor:pointer;user-select:none;transition:color .15s ease}
.tbi-table th.tbi-sortable:hover{color:var(--dsw-alias-label-primary)}
.tbi-table th.tbi-sortable[data-sort]{color:var(--dsw-alias-label-primary)}
.tbi-sortCaret{font-size:10px;opacity:.85}
/* Paging under the table: previous / range / next, plus a page-size picker. */
.tbi-pager{display:flex;align-items:center;gap:8px;justify-content:flex-end;padding:10px 4px 2px;color:var(--dsw-alias-label-secondary);font-size:11px}
.tbi-pagerBtn{width:24px;height:22px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.tbi-pagerBtn:hover:enabled{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.tbi-pagerBtn:disabled{opacity:.35;cursor:default}
.tbi-pagerLabel{font-variant-numeric:tabular-nums;min-width:88px;text-align:center}
.tbi-pagerSize{font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs);padding:1px 4px;cursor:pointer}
.tbi-scrollBody{max-height:min(52vh,460px);overflow:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent}
.tbi-scrollBody::-webkit-scrollbar{width:8px;height:8px}
.tbi-scrollBody::-webkit-scrollbar-track{background:transparent}
.tbi-scrollBody::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:4px}
.tbi-scrollBody::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-border-l3)}
.tbi-table th{position:sticky;top:0;z-index:1;background:var(--dsw-alias-bg-layer-1);text-align:left;font-weight:400;color:var(--dsw-alias-label-tertiary);padding:0 10px 8px;white-space:nowrap;border-bottom:1px solid var(--dsw-alias-border-l2)}
.tbi-table th[data-align=right],.tbi-table td[data-align=right]{text-align:right}
.tbi-table td{padding:9px var(--tbi-cell-pad);border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:middle}
.tbi-table tbody tr[data-clickable=true]{cursor:pointer}
.tbi-table tbody tr[data-clickable=true]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.tbi-sessionName{display:flex;align-items:center;gap:8px;min-width:0}
.tbi-caret{width:12px;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.tbi-caret[data-open=true]{transform:rotate(90deg)}
.tbi-sessionTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px}
.tbi-pill{display:inline-flex;align-items:center;height:16px;padding:0 6px;border-radius:999px;font-size:10px;line-height:16px;white-space:nowrap;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.tbi-pill[data-live=true]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent);color:var(--dsw-alias-state-success-primary)}
.tbi-pill[data-sub=true]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-state-business-primary)}
.tbi-pill[data-kind=search]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary) 18%, transparent);color:var(--dsw-alias-state-warning-primary);font-size:10px;padding:1px 6px;border-radius:999px;font-weight:500}
.tbi-pill[data-kind=title]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-state-business-primary);font-size:10px;padding:1px 6px;border-radius:999px;font-weight:500}
/* The fold switch sits on the row, beside the title whose children it hides.
   It is deliberately a bordered pill and not another bare caret: the row
   already carries a caret for its own turn timeline, and two identical arrows
   in one row would be a guessing game. */
.tbi-foldBtn{display:inline-flex;align-items:center;gap:4px;height:16px;padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1;cursor:pointer;flex:none;font-variant-numeric:tabular-nums;transition:border-color 0.15s ease,color 0.15s ease,background 0.15s ease}
.tbi-foldBtn:hover{border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.tbi-foldBtn[data-sub=true]{border-color:transparent;background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent);color:var(--dsw-alias-state-business-primary)}
.tbi-foldBtn[data-sub=true]:hover{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 24%, transparent)}
.tbi-foldCaret{flex:none;transition:transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.tbi-foldBtn[data-open=true] .tbi-foldCaret{transform:rotate(90deg)}
.tbi-num{font-variant-numeric:tabular-nums}
.tbi-weak{color:var(--dsw-alias-label-tertiary)}
.tbi-detailRow td{background:var(--dsw-alias-bg-layer-2);padding:0}
.tbi-detail{padding:14px 16px 18px;display:flex;flex-direction:column;gap:12px}
.tbi-detail[data-nested=true]{border-left:2px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-xs) 0 0 var(--dsw-radius-xs)}
.tbi-spark{width:100%;display:block;overflow:visible}
.tbi-turnToolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-bottom:6px;flex-wrap:wrap}
.tbi-turnFilters{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.tbi-turnFilterBtn{padding:2px 8px;border-radius:999px;font-size:10px;line-height:16px;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:all 0.15s ease}
.tbi-turnFilterBtn:hover{border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.tbi-turnFilterBtn[data-active=true]{background:var(--dsw-alias-state-business-primary);color:#fff;font-weight:600;border-color:var(--dsw-alias-state-business-primary)}
.tbi-turnShowAllBtn{font-size:11px;color:var(--dsw-alias-state-business-primary);background:none;border:none;cursor:pointer;padding:2px 4px}
.tbi-turnShowAllBtn:hover{text-decoration:underline}
.tbi-turnList{display:flex;flex-direction:column;gap:3px;max-height:420px;overflow:auto}
.tbi-turnHeader{display:grid;grid-template-columns:80px 180px 115px 1fr 80px;align-items:center;gap:12px;padding:4px 8px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary);border-bottom:1px solid var(--dsw-alias-border-l3);margin-bottom:2px}
.tbi-turnRow{display:grid;grid-template-columns:80px 180px 115px 1fr 80px;align-items:center;gap:12px;padding:4px 8px;font-size:11px;border-radius:var(--dsw-radius-xs);transition:background 0.15s ease}
.tbi-turnRow:hover{background:var(--dsw-alias-bg-layer-3)}
.tbi-turnLabel{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-weight:500}
.tbi-turnModel{color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tbi-turnTime{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px}
.tbi-turnBar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;display:flex}
.tbi-turnSeg{height:100%}
.tbi-turnTotal{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:500}
.tbi-tree{display:flex;flex-direction:column;gap:2px;max-height:min(46vh,400px);overflow:auto;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;padding-right:4px}
.tbi-tree::-webkit-scrollbar{width:8px;height:8px}
.tbi-tree::-webkit-scrollbar-track{background:transparent}
.tbi-tree::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:4px}

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
/* A list that unrolls under the pointer, and folds back when it leaves.
   The height animates from the measured folded height to the measured full
   height, so the cards below slide down instead of jumping, and a longer list
   unrolls further. */
.tbi-roll{position:relative;display:flex;flex-direction:column}
.tbi-rollBody{overflow:hidden;transition:max-height 320ms cubic-bezier(.4,0,.2,1);will-change:max-height}
.tbi-roll[data-folds=false] .tbi-rollBody{transition:none}
/* The roller: an edge the pointer can rest on, plus a quiet count. It reads as
   the bottom of a scroll rather than a button, which is the whole point. */
.tbi-rollHandle{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:2px;padding:3px 0;border:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:10px;line-height:1;opacity:.75;transition:opacity 160ms ease}
.tbi-rollHandle:hover{opacity:1;color:var(--dsw-alias-label-secondary)}
.tbi-rollHandleBar{display:block;height:3px;flex:0 1 78px;border-radius:999px;background:linear-gradient(90deg,transparent,var(--dsw-alias-border-l2) 22%,var(--dsw-alias-border-l2) 78%,transparent)}
.tbi-rollHandle:hover .tbi-rollHandleBar{background:linear-gradient(90deg,transparent,var(--dsw-alias-border-l3) 22%,var(--dsw-alias-border-l3) 78%,transparent)}
.tbi-rollHandleCount{font-variant-numeric:tabular-nums;white-space:nowrap}
.tbi-roll[data-open=true] .tbi-rollHandleBar{background:linear-gradient(90deg,transparent,var(--dsw-alias-state-business-primary) 22%,var(--dsw-alias-state-business-primary) 78%,transparent);opacity:.5}
.tbi-roll[data-pinned=true] .tbi-rollHandle{cursor:default;opacity:.4}
.tbi-split{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
.tbi-tooltip{position:fixed;z-index:60;pointer-events:none;padding:6px 8px;border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-tooltip-bg);color:var(--dsw-alias-toast-label);font-size:11px;line-height:16px;white-space:pre-wrap;overflow-wrap:anywhere;max-width:min(560px,calc(100vw - 32px));border:1px solid var(--dsw-alias-border-l3)}
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

    /**
     * A stable colour per model, so a slice keeps its identity across the
     * chart, the model card and the legend.
     *
     * Derived from the key rather than from its rank: a model must not change
     * colour when a new one outspends it, or yesterday's chart no longer reads
     * the same as today's. Golden-angle spacing spreads neighbouring keys far
     * apart in hue, which is what keeps a fourteen-slice stack legible.
     */
    const MODEL_HUES = 12;
    const modelPalette = (key) => {
      let hash = 0;
      for (let index = 0; index < key.length; index += 1) {
        hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
      }
      const slot = hash % MODEL_HUES;
      // Every colour is mixed toward the panel's own label colour so the stack
      // sits inside the theme instead of fighting it (and stays readable in
      // both light and dark themes).
      return `color-mix(in srgb, hsl(${(slot * 360) / MODEL_HUES} 62% 52%) 82%, var(--dsw-alias-label-primary) 18%)`;
    };
    const pad = (value) => String(value).padStart(2, '0');
    const dayLabel = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
    const exactTime = (ms, offsetMinutes) => {
      if (!Number.isFinite(ms)) return '—';
      const shifted = new Date(ms + offsetMinutes * 60_000);
      return `${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
    };
    const timeLabel = (ms, offsetMinutes) => {
      if (!Number.isFinite(ms)) return '—';
      const shifted = new Date(ms + offsetMinutes * 60_000);
      return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
    };
    //#endregion

    //#region last report
    /**
     * The last report this browser saw, per time window, so the panel has
     * something to draw the instant it is opened.
     *
     * The host unmounts this page whenever the user switches away and mounts it
     * again on the way back, so every visit used to start from an empty state:
     * a cold "正在读取会话日志…" and a few hundred milliseconds of blank, for
     * numbers that had not changed since ten seconds ago. The server has a
     * persistent cache, but a round trip still has to happen before anything can
     * be drawn. Keeping the finished report here means the previous numbers are
     * on screen immediately and the rebuild happens behind them.
     *
     * It is a paint cache, not a source of truth: whatever the server returns
     * replaces it wholesale, and it expires on its own so an age-old snapshot
     * can never be mistaken for the current total.
     */
    const SNAPSHOT_PREFIX = 'dsh-token-bi:report:v2';
    /**
     * A snapshot older than this is not worth painting. The panel refreshes on
     * every open, so this only decides what the *first* frame looks like — and a
     * frame showing yesterday's number is worse than a blank one.
     */
    const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

    // One snapshot, for the one report the page now holds: the whole history.
    // Windows are slices of it, so there is no per-window entry to keep.
    const snapshotKey = () => SNAPSHOT_PREFIX;

    const readSnapshot = () => {
      try {
        if (typeof localStorage === 'undefined') return undefined;
        const raw = localStorage.getItem(snapshotKey());
        if (raw === null) return undefined;
        const parsed = JSON.parse(raw);
        const report = parsed?.report;
        // The chart code walks these as arrays; a partial object would crash
        // deep inside a chart instead of showing the cold state.
        if (!Array.isArray(report?.sessions) || !Array.isArray(report?.days) || !Array.isArray(report?.models)) return undefined;
        if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > SNAPSHOT_MAX_AGE_MS) return undefined;
        return { report, savedAt: parsed.savedAt };
      } catch {
        // Private mode, a full quota, a hand-edited value — none of these are
        // worth failing a page open over.
        return undefined;
      }
    };

    const writeSnapshot = (report) => {
      try {
        if (typeof localStorage === 'undefined') return;
        if (!Array.isArray(report?.sessions) || report.sessions.length === 0) return;
        localStorage.setItem(snapshotKey(), JSON.stringify({ savedAt: Date.now(), report }));
      } catch {
        // Best effort. Over quota is the normal reason, and losing a paint
        // cache is not worth an error message.
      }
    };
    //#endregion

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
      cwds: [],
      errors: [],
    };

    /**
     * Order rows parent-first so delegated children sit under their parent.
     * Each row also carries what the flat table cannot show: the session's own
     * spend, how much of its subtree the delegated children account for, and
     * the parent it hangs from — the last one is what lets the list fold a
     * branch away and then unfold exactly the branch a lookup needs.
     *
     * Rows come out in pre-order (a parent immediately precedes its subtree),
     * which is what makes the collapse pass below a single linear sweep.
     */
    function buildForest(sessions, spendOf) {
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
      // The bar has to measure the same amount the table row prints, which is
      // the filtered one (that day, that model) rather than the lifetime total.
      const spend = typeof spendOf === 'function' ? spendOf : (session) => session.totals?.total ?? 0;
      const timeVal = (session) => Number(session.lastTime) || 0;
      const sortRows = (rows) => rows.sort((left, right) => timeVal(right) - timeVal(left) || spend(right) - spend(left));
      sortRows(roots);
      for (const bucket of children.values()) sortRows(bucket);
      const rows = [];
      const visit = (session, depth, parentId, ancestors) => {
        const kids = children.get(session.id) ?? [];
        const childTotal = kids.reduce((sum, child) => sum + spend(child), 0);
        rows.push({ session, depth, own: spend(session) - childTotal, childTotal, children: kids.length, parentId, ancestors });
        for (const child of kids) visit(child, depth + 1, session.id, [...ancestors, session.id]);
      };
      for (const root of roots) visit(root, 0, null, []);
      // Sessions whose parent is outside the visible corpus still belong in the list.
      const seen = new Set(rows.map((row) => row.session.id));
      for (const session of sortRows(sessions.filter((entry) => !seen.has(entry.id)))) {
        rows.push({ session, depth: 0, own: spend(session), childTotal: 0, children: 0, parentId: null, ancestors: [] });
      }
      return rows;
    }

    /**
     * The rows a folded list should draw: pre-order rows minus everything below
     * a node the user has collapsed.
     *
     * `open` holds the ids whose children are currently shown, so an empty set
     * means "everything folded", which is the default — a long tail of subagent
     * rows should not be in the way until it is asked for.
     */
    function visibleForestRows(rows, open) {
      const visible = [];
      let resumeAtDepth = null;
      for (const row of rows) {
        if (resumeAtDepth !== null && row.depth >= resumeAtDepth) continue;
        resumeAtDepth = null;
        visible.push(row);
        if (row.children > 0 && !open.has(row.session.id)) resumeAtDepth = row.depth + 1;
      }
      return visible;
    }

    function stackTotals(day) {
      return day.input + day.output + day.cacheRead + day.cacheWrite;
    }

    /**
     * What a chart should plot for one day.
     *
     * Billed tool calls report no tokens, so a token chart under a tool filter
     * would be a row of zeros and read as "nothing happened". The honest measure
     * there is the request count, which is what the bill actually charges for.
     */
    function dayMeasure(day, useCalls) {
      return useCalls ? (day.calls ?? 0) : stackTotals(day);
    }

    /**
     * The window the headline numbers cover, so they are never read as all-time.
     *
     * With the panel holding one all-time report, the note follows the slice on
     * screen: an all-time window names its first real day, a fixed window names
     * its two edges.
     */
    function rangeNote(days, range, t) {
      if (days.length === 0) return t('rangeAll');
      return `${dayLabel(days[0].day)} – ${dayLabel(days[days.length - 1].day)}`;
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
     *
     * A chart that needs to *decide* when the card appears (the daily column
     * chart waits for the pointer to rest) can pass `text` instead: the wrapper
     * then just positions whatever it is handed, and owns no state of its own.
     */
    function Tooltip({ children, text, owner }) {
      const [tip, setTip] = React.useState(null);
      const [at, setAt] = React.useState({ x: 0, y: 0 });
      const boxRef = React.useRef(null);
      const [size, setSize] = React.useState({ w: 0, h: 0 });
      const controlled = text !== undefined;
      const shown = controlled ? text : tip;
      const show = React.useCallback((next) => setTip(next), []);
      const hide = React.useCallback(() => setTip(null), []);
      // The tip is centred on the cursor, so a long one (a full workspace
      // path) would run past the viewport edge and get cut. Measure it and
      // keep it on screen; flip below the cursor when there is no room above.
      React.useLayoutEffect(() => {
        const el = boxRef.current;
        const next = el === null ? { w: 0, h: 0 } : { w: el.offsetWidth, h: el.offsetHeight };
        if (next.w !== size.w || next.h !== size.h) setSize(next);
      });
      const viewport = typeof window === 'undefined' ? { width: 1024, height: 768 } : window;
      const margin = 8;
      const half = size.w / 2;
      const minX = half + margin;
      const maxX = Math.max(minX, viewport.innerWidth - half - margin);
      const x = Math.min(Math.max(at.x, minX), maxX);
      const above = at.y - 12 - size.h >= margin;
      const y = above ? at.y - 12 : at.y + 18;
      return h(
        'div',
        {
          onMouseMove: (event) => setAt({ x: event.clientX, y: event.clientY }),
          onMouseLeave: hide,
          style: { position: 'relative' },
        },
        children({ show, hide }),
        shown === null || shown === undefined
          ? null
          : h(
              'div',
              {
                ref: boxRef,
                className: 'tbi-tooltip',
                'data-owner': owner,
                style: { left: `${x}px`, top: `${y}px`, transform: above ? 'translate(-50%,-100%)' : 'translate(-50%,0)' },
              },
              shown,
            ),
      );
    }

    /**
     * The caret on a sortable column head.
     *
     * Only the active column shows one: a header row where every column carries
     * an arrow is noise, and the reader only needs to know which way the
     * current order runs.
     */
    function sortCaret(active, desc) {
      if (!active) return null;
      return h('span', { className: 'tbi-sortCaret' }, desc ? ' ↓' : ' ↑');
    }

    /**
     * Decide what a wheel gesture over a scrollable box should do.
     *
     * Split out from the effect so the rule can be checked without a real
     * layout: the browser test harness has no scrolling boxes to measure.
     *
     *   'list'  — the box is scrolling itself, keep the gesture here;
     *   'page'  — the box is at the end the gesture is heading for (or has
     *             nothing to scroll at all), so the page should take it.
     */
    function wheelIntent({ deltaX, deltaY }, { scrollTop, clientHeight, scrollHeight }) {
      // A horizontal gesture belongs to the box, never to the page.
      if (Math.abs(deltaX) > Math.abs(deltaY)) return 'list';
      const canScroll = scrollHeight - clientHeight > 1;
      if (!canScroll) return 'page';
      const goingUp = deltaY < 0;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
      if (goingUp && atTop) return 'page';
      if (!goingUp && atBottom) return 'page';
      return 'list';
    }

    /**
     * Let the outer panel scroll when an inner list cannot.
     *
     * Every scrolling card in this panel — the session table, the call tree, a
     * session's turn timeline — sits inside one big scroller. By default the
     * inner box swallows the wheel even when it has nothing to scroll, so with
     * the pointer over the table the page simply stopped, and the only way to
     * keep reading was to move the pointer to the margin first.
     *
     * Handing the gesture over means scrolling the ancestor ourselves:
     * cancelling the event alone does not make the page move.
     */
    function useWheelChaining() {
      const ref = React.useRef(null);
      React.useEffect(() => {
        const el = ref.current;
        if (el === null) return;
        /** The nearest ancestor that can actually scroll. */
        const outerScroller = () => {
          let node = el.parentElement;
          while (node !== null) {
            if (node.scrollHeight - node.clientHeight > 1) {
              const overflowY = getComputedStyle(node).overflowY;
              if (overflowY === 'auto' || overflowY === 'scroll') return node;
            }
            node = node.parentElement;
          }
          return null;
        };
        const onWheel = (event) => {
          const intent = wheelIntent(event, el);
          if (intent === 'list') {
            // The list is scrolling itself; keep the gesture here.
            event.stopPropagation();
            return;
          }
          // Nothing left here — move the page instead of swallowing the wheel.
          const outer = outerScroller();
          if (outer === null) return;
          event.preventDefault();
          outer.scrollBy({ top: event.deltaY, behavior: 'auto' });
        };
        // `passive: false` is required for preventDefault to mean anything on a
        // wheel listener.
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
      }, []);
      return ref;
    }

    function Figure({ label, value, unit, note, exact }) {
      return h(
        'div',
        { className: 'tbi-figure' },
        h('div', { className: 'tbi-figureLabel' }, label),
        h('div', { className: 'tbi-figureValue' }, value, unit === undefined ? null : h('span', { className: 'tbi-figureUnit' }, unit)),
        // The exact count, small and grey, so it can be selected and copied
        // without fighting the compacted headline above it.
        exact === undefined
          ? null
          : h('div', { className: 'tbi-figureExact' }, String(exact)),
        note === undefined ? null : h('div', { className: 'tbi-figureNote' }, note),
      );
    }

    /**
     * The model legend for the stacked column chart: swatches only.
     *
     * A bill routinely has a dozen-plus models, and printing every name pushed
     * the legend onto three lines and squeezed the card head. The colour alone
     * is enough to map a slice to a legend entry; the name arrives on hover,
     * the same way the chart's own tooltips do.
     *
     * Clicking a swatch focuses that model — every other slice in the chart
     * fades, which is the only practical way to follow one series in a
     * fourteen-slice stack. Clicking it again clears the focus.
     */
    function ModelLegend({ t, series, palette, focus, onFocus }) {
      if (series.length === 0) return null;
      return h(
        'div',
        { className: 'tbi-legend tbi-modelLegend' },
        h(Tooltip, null, ({ show, hide }) =>
          h(
            'div',
            { className: 'tbi-swatchRow' },
            series.map((entry) =>
              h(
                'button',
                {
                  key: entry.key,
                  type: 'button',
                  className: 'tbi-swatchBtn',
                  'data-focus': focus === entry.key,
                  'data-muted': focus !== null && focus !== entry.key,
                  'aria-label': `${entry.provider}/${entry.model}`,
                  onMouseEnter: () => show(`${entry.provider}/${entry.model}\n${compact(entry.total)} ${t('tokensShort')}\n(${t('clickToFilter')})`),
                  onMouseMove: () => show(`${entry.provider}/${entry.model}\n${compact(entry.total)} ${t('tokensShort')}\n(${t('clickToFilter')})`),
                  onMouseLeave: hide,
                  onClick: () => onFocus(focus === entry.key ? null : entry.key),
                },
                h('i', { style: { background: palette(entry.key) } }),
              ),
            ),
          ),
        ),
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

    /**
     * A list that unrolls like a scroll when the pointer arrives.
     *
     * The model and workspace cards can hold dozens of rows. Printing them all
     * made the two cards tall whether or not anyone was reading them, and
     * folding the remainder behind a "N more" line hid real spend behind a
     * number nobody could click.
     *
     * So the card shows `folded` rows by default and unrolls over the full list
     * when the pointer enters. The height animates, which is what pushes the
     * cards below it down smoothly instead of jumping, and the unroll distance
     * follows the data — twenty rows unroll twice as far as ten.
     *
     * Two deliberate exceptions:
     *   - at most `folded` rows never folds, because there is nothing to hide;
     *   - a selection inside the list pins it open, because folding a list out
     *     from under the row the user just clicked hides what they are reading.
     */
    function ScrollCard({ t, folded = 10, pinnedIndex = -1, items }) {
      const listRef = React.useRef(null);
      const [hovered, setHovered] = React.useState(false);
      const [foldedHeight, setFoldedHeight] = React.useState(null);
      const [fullHeight, setFullHeight] = React.useState(null);
      const count = items.length;
      const folds = count > folded;
      // Only a selection that would be hidden by folding pins the list open. A
      // selected row inside the visible window needs no pin: it is already on
      // screen, and pinning on it would unroll the card for a click the user
      // never made.
      const pinned = folds && pinnedIndex >= folded;
      const open = !folds || pinned || hovered;

      // Measure both heights from the real rows rather than assuming a row
      // height: the rows carry variable-size labels and a two-line tooltip, and
      // a guessed constant clips a long list or leaves a gap under a short one.
      React.useLayoutEffect(() => {
        const el = listRef.current;
        if (el === null || !folds) {
          setFoldedHeight(null);
          setFullHeight(null);
          return;
        }
        const rows = Array.from(el.children);
        if (rows.length < folded) return;
        // Distance from the top of the list to the bottom of the Nth row.
        const lastVisible = rows[folded - 1];
        const start = el.getBoundingClientRect().top;
        const cut = lastVisible.getBoundingClientRect().bottom - start;
        setFoldedHeight(Math.ceil(cut));
        setFullHeight(Math.ceil(el.scrollHeight));
      }, [count, folds, folded, items]);

      return h(
        'div',
        {
          className: 'tbi-roll',
          'data-folds': folds,
          'data-open': open,
          'data-pinned': folds && pinned,
          // Leaving always folds back — but only once the pointer is clear of the
          // list itself. `onMouseLeave` on the outer box covers the unfolded
          // rows too, so reading down a long list does not slam it shut.
          onMouseLeave: folds ? () => setHovered(false) : undefined,
        },
        h(
          'div',
          {
            ref: listRef,
            className: 'tbi-rollBody',
            // `max-height` is the only property that can animate from "this
            // much" to "however tall the data is" while the content reflows.
            style: folds && open === false && foldedHeight !== null
              ? { maxHeight: `${foldedHeight}px` }
              : folds && open === true && fullHeight !== null
                ? { maxHeight: `${fullHeight}px` }
                : undefined,
          },
          items,
        ),
        // The roller is the *only* trigger: it is the affordance that says there
        // is more under here, so the card no longer springs open merely because
        // the pointer crossed it on the way somewhere else.
        folds
          ? h(
              'button',
              {
                type: 'button',
                className: 'tbi-rollHandle',
                'aria-expanded': open,
                'aria-label': open ? `${count} ${t('foldHint')}` : `${count} ${t('unfoldHint')}`,
                title: open ? t('foldHint') : t('unfoldHint'),
                // Hovering the roller unrolls the list; clicking pins the state
                // so it survives the pointer leaving.
                onMouseEnter: () => setHovered(true),
                onClick: () => setHovered((current) => !current),
              },
              h('span', { className: 'tbi-rollHandleBar' }),
              h('span', { className: 'tbi-rollHandleCount' }, open ? `${count}` : `${folded}/${count}`),
            )
          : null,
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

    /**
     * One button that opens or closes every branch in both lists at once.
     *
     * Folded-by-default is the right opening state, but a reader who wants the
     * whole tree back should not have to click twenty pills to get it.
     */
    function foldAllButton({ t, foldableIds, foldedCount, setAllBranches }) {
      if (foldableIds.length === 0) return null;
      const anyFolded = foldedCount > 0;
      return h(
        'button',
        {
          type: 'button',
          className: 'tbi-btn',
          onClick: () => setAllBranches(anyFolded),
          title: anyFolded ? t('unfoldAllHint') : t('foldAllHint'),
        },
        anyFolded ? t('unfoldAll') : t('foldAll'),
      );
    }
    //#endregion

    //#region charts
    /**
     * Daily stacked columns. One column per day, four stacked segments, a
     * hairline grid and value labels only on the tallest three columns so the
     * axis does not become a wall of numbers.
     */
    /**
     * Daily columns, stacked by model.
     *
     * Stacking by cost bucket (input / output / cache read / cache write)
     * answers "what kind of spend is this"; the question a bill actually
     * raises is "whose spend is this". So the column is split by model, and
     * the four cost buckets remain on the hover card and in the legend of the
     * session detail.
     *
     * Hovering does two things at once, because a stack of up to fourteen
     * slices is unreadable without them:
     *   - the whole column lifts out of the chart on a translucent shadow, so
     *     the day under the pointer is unmistakable;
     *   - pointing at one slice dims every other model in the chart, so a
     *     single series can be followed across the window.
     */
    function DailyChart({ days, t, selectedDay, onSelectDay, useCalls, series, palette, focusModel }) {
      const width = 960;
      const height = 220;
      const padding = { top: 14, right: 8, bottom: 22, left: 44 };
      const innerW = width - padding.left - padding.right;
      const innerH = height - padding.top - padding.bottom;
      const rows = days;
      const [hoverDay, setHoverDay] = React.useState(null);
      // Which model the pointer is currently over, if any. Hover focus is
      // transient by design — it clears the moment the pointer leaves the
      // chart, unlike the legend's pinned focus.
      const [hoverModel, setHoverModel] = React.useState(null);

      /**
       * Dwell-to-show for the column tooltip.
       *
       * A bill is read by scanning the columns, and a tooltip that follows the
       * pointer pops up on every column it crosses — the reader is looking at
       * the shape, not asking about a day yet. So the card waits for the
       * pointer to come to rest: `DWELL_MS` after the last movement.
       *
       * Once it is up, moving *within* the same column must not flicker it away
       * and re-arm the timer; only leaving the column's x-range hides it. That
       * is the difference between "hovering a day" and "sweeping across the
       * chart", and it is the one the pointer actually means.
       */
      // One second of stillness opens the card. Hooked through `globalThis`
      // only so the render test can shorten it and still exercise the timer.
      const DWELL_MS = typeof globalThis !== 'undefined' && Number.isFinite(globalThis.__tbiDwellMs)
        ? globalThis.__tbiDwellMs
        : 1000;
      /**
       * Which day the card is open for, or null.
       *
       * Only the day is stored — never the finished text. The card marks the
       * slice under the pointer with an arrow, so its content depends on where
       * the pointer is *now*; freezing the text at the moment the timer fired
       * left that arrow pinned to whichever slice happened to be under the
       * pointer when the card opened.
       */
      const [openDay, setOpenDay] = React.useState(null);
      const dwellTimer = React.useRef(null);
      /** The day whose card is currently on screen, mirroring `openDay`. */
      const shownDay = React.useRef(null);

      const clearDwell = React.useCallback(() => {
        if (dwellTimer.current !== null) {
          window.clearTimeout(dwellTimer.current);
          dwellTimer.current = null;
        }
      }, []);

      /** Restart the wait. Called on every pointer move over a column. */
      const armDwell = React.useCallback((day) => {
        // Already up for this column: movement inside it changes nothing, and
        // the card is re-rendered from live state on every pass anyway.
        if (shownDay.current === day) return;
        clearDwell();
        // A new column takes the previous card down at once, then re-arms: the
        // reader has moved on, so leaving the old card up would be a lie.
        if (shownDay.current !== null) {
          shownDay.current = null;
          setOpenDay(null);
        }
        dwellTimer.current = window.setTimeout(() => {
          dwellTimer.current = null;
          shownDay.current = day;
          setOpenDay(day);
        }, DWELL_MS);
      }, [clearDwell]);

      /** Leaving the column's x-range takes the card down and disarms. */
      const dropDwell = React.useCallback(() => {
        clearDwell();
        shownDay.current = null;
        setOpenDay(null);
      }, [clearDwell]);

      React.useEffect(() => () => clearDwell(), [clearDwell]);

      // Under a tool filter the axis is request counts, which have no model
      // breakdown in tokens; one solid bar per day is the honest shape.
      const byModel = !useCalls && series !== undefined && series.length > 0;
      const modelOf = (key) => series.find((entry) => entry.key === key);
      const valueOf = (day) => {
        if (!byModel) return dayMeasure(day, useCalls);
        let sum = 0;
        for (const entry of series) sum += entry.perDay.get(day.day) ?? 0;
        return sum;
      };

      const max = Math.max(1, ...rows.map(valueOf));
      const slot = innerW / Math.max(1, rows.length);
      const barW = Math.max(1, Math.min(28, slot * 0.72));
      const ticks = [0, 0.5, 1].map((fraction) => Math.round(max * fraction));
      const topValues = new Set(
        [...rows]
          .map((row, index) => ({ index, value: valueOf(row) }))
          .sort((left, right) => right.value - left.value)
          .slice(0, 3)
          .map((entry) => entry.index),
      );
      const base = padding.top + innerH;

      /** The hover card: day total, then every model that day, biggest first. */
      const tipFor = (row) => {
        const total = valueOf(row);
        if (useCalls) return `${row.day}  ${total} ${t('callsUnit')}\n(${t('clickToFilter')})`;
        if (total <= 0) return `${row.day}\n${t('noSpend')}`;
        if (!byModel) {
          return (
            `${row.day}  ${compact(total)} token\n` +
            `${t('legendInput')} ${exact(row.input)} · ${t('legendOutput')} ${exact(row.output)}\n` +
            `${t('legendCacheRead')} ${exact(row.cacheRead)} · ${t('legendCacheWrite')} ${exact(row.cacheWrite)}\n` +
            `${t('cacheShare')} ${percent(row.cacheRead ?? 0, total)}\n` +
            `${row.sessions ?? 0} ${t('sessionsUnit')}\n` +
            `(${t('clickToFilter')})`
          );
        }
        // The slice under the pointer is marked so the card and the highlight
        // agree on which model the reader is looking at.
        //
        // Every model that day is listed, not just the top few: a busy day can
        // carry a dozen models, and quietly truncating the list made the card
        // disagree with the stack it was describing. Beyond eight entries the
        // list switches to two columns so the card stays a card rather than a
        // column taller than the chart.
        const mark = (key) => (hoverModel === key || (hoverModel === null && focusModel === key) ? '▸ ' : '  ');
        const entries = series
          .filter((entry) => (entry.perDay.get(row.day) ?? 0) > 0)
          .sort((left, right) => (right.perDay.get(row.day) ?? 0) - (left.perDay.get(row.day) ?? 0));
        const label = (entry) => `${mark(entry.key)}${entry.model} ${exact(entry.perDay.get(row.day) ?? 0)}`;
        let parts;
        if (entries.length > 8) {
          const half = Math.ceil(entries.length / 2);
          const left = entries.slice(0, half).map(label);
          const right = entries.slice(half).map(label);
          const width = Math.max(...left.map((line) => line.length), 0) + 2;
          parts = left.map((line, index) => line.padEnd(width) + (right[index] ?? ''));
        } else {
          parts = entries.map(label);
        }
        return `${row.day}  ${compact(total)} token\n` +
          `${row.sessions ?? 0} ${t('sessionsUnit')}\n` +
          `${parts.join('\n')}\n` +
          `${t('cacheShare')} ${percent(row.cacheRead ?? 0, total)}\n` +
          `(${t('clickToFilter')})`;
      };

      // Built fresh on every render from the open day and the slice under the
      // pointer, so the arrow always names the slice being hovered *now*.
      const openRow = openDay === null ? undefined : rows.find((row) => row.day === openDay);
      const dwellTip = openRow === undefined ? null : tipFor(openRow);

      return h(
        Tooltip,
        // Controlled: this chart decides when the card appears (it waits for
        // the pointer to rest), so it hands the wrapper finished text rather
        // than letting the wrapper own the state.
        { text: dwellTip, owner: 'daily' },
        () =>
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
              const total = valueOf(row);
              const isSelected = selectedDay === row.day;
              const isDimmed = selectedDay !== null && selectedDay !== row.day;
              const isHovered = hoverDay === row.day;
              const pieces = [];
              let cursor = base;

              if (byModel) {
                // Bottom-up in the same order as the ranking, so the biggest
                // spender is always the slice sitting on the axis.
                //
                // Two focus sources, hover wins: pointing at a slice isolates
                // that model on the spot, and a legend click pins the isolation
                // so it survives the pointer leaving the chart.
                const effectiveFocus = hoverModel ?? focusModel;
                for (const entry of series) {
                  const value = entry.perDay.get(row.day) ?? 0;
                  if (value <= 0) continue;
                  const segH = (value / max) * innerH;
                  cursor -= segH;
                  const faded = effectiveFocus !== null && effectiveFocus !== entry.key;
                  const isFocusedSlice = effectiveFocus === entry.key;
                  pieces.push(
                    h('rect', {
                      key: entry.key,
                      x,
                      y: cursor,
                      width: barW,
                      height: Math.max(0.5, segH),
                      fill: palette(entry.key),
                      // The palette has twelve hues, so two models can share a
                      // colour. The key travels on the node so focus logic and
                      // tests never have to infer identity from the fill.
                      'data-model': entry.key,
                      'data-muted': faded,
                      // A pointer over a slice focuses it; leaving the chart
                      // clears hover focus but never the pinned one.
                      onMouseEnter: () => setHoverModel(entry.key),
                      style: {
                        opacity: faded ? 0.18 : 1,
                        // The focused slice gets a hairline so it stays
                        // identifiable when it is a two-pixel sliver.
                        stroke: isFocusedSlice ? 'var(--dsw-alias-label-primary)' : 'none',
                        strokeWidth: isFocusedSlice ? 0.75 : 0,
                        transition: 'opacity .12s ease',
                      },
                    }),
                  );
                }
              } else if (useCalls) {
                if (total > 0) {
                  const segH = (total / max) * innerH;
                  pieces.push(
                    h('rect', {
                      key: 'calls',
                      x,
                      y: base - segH,
                      width: barW,
                      height: Math.max(1, segH),
                      fill: 'var(--tbi-fill-input)',
                    }),
                  );
                }
              }

              return h(
                'g',
                {
                  key: row.day,
                  className: 'tbi-col',
                  'data-selected': isSelected,
                  'data-dimmed': isDimmed,
                  'data-hover': isHovered,
                  onClick: () => onSelectDay?.(isSelected ? null : row.day),
                  onMouseEnter: () => {
                    setHoverDay(row.day);
                    armDwell(row.day);
                  },
                  // Movement keeps re-arming the dwell timer, which is how
                  // "come to rest" is detected. The card, once up, stays: it is
                  // only taken down when the pointer leaves the column.
                  onMouseMove: () => {
                    setHoverDay(row.day);
                    armDwell(row.day);
                  },
                  onMouseLeave: () => {
                    setHoverDay(null);
                    // Hover focus is per-column, so it must not survive the
                    // pointer leaving: the pinned legend focus is the one that
                    // is meant to persist.
                    setHoverModel(null);
                    dropDwell();
                  },
                  style: { cursor: 'pointer' },
                },
                // The column shadow. It is drawn first so the bars sit on top,
                // and it covers the full plot height — a hover has to read as
                // "this day" even when the bar itself is short.
                h('rect', {
                  className: 'tbi-colShadow',
                  x: padding.left + index * slot,
                  y: padding.top,
                  width: slot,
                  height: innerH,
                  fill: 'transparent',
                }),
                // The hit band goes *under* the slices, not over them. Drawn on
                // top it swallowed every pointer event, so hovering a slice
                // never fired and per-model focus could not work. Empty space
                // above a short bar still reaches this band, which is what keeps
                // a quiet day hoverable and clickable.
                h('rect', {
                  x: padding.left + index * slot,
                  y: padding.top,
                  width: slot,
                  height: innerH,
                  fill: 'transparent',
                  style: { pointerEvents: 'all' },
                }),
                pieces,
                topValues.has(index) && total > 0
                  ? h(
                      'text',
                      { className: 'tbi-axis', x: x + barW / 2, y: base - (total / max) * innerH - 5, textAnchor: 'middle' },
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

    /** Daily trend line & area chart. */
    function DailyTrendChart({ days, t, selectedDay, onSelectDay, useCalls }) {
      const width = 960;
      const height = 200;
      const padding = { top: 14, right: 12, bottom: 24, left: 44 };
      const innerW = width - padding.left - padding.right;
      const innerH = height - padding.top - padding.bottom;
      const rows = days;
      if (rows.length === 0) return h('p', { className: 'tbi-weak' }, t('empty'));
      const max = Math.max(1, ...rows.map((row) => dayMeasure(row, useCalls)));
      const stepX = innerW / Math.max(1, rows.length - 1);
      const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));

      const point = (row, index) => {
        const total = dayMeasure(row, useCalls);
        const x = padding.left + index * stepX;
        const y = padding.top + innerH - (total / max) * innerH;
        return [x, y, total];
      };

      const pts = rows.map((row, index) => point(row, index));
      const lineStr = pts.map(([x, y]) => `${x},${y}`).join(' ');
      const areaStr = `${padding.left},${padding.top + innerH} ${lineStr} ${padding.left + (rows.length - 1) * stepX},${padding.top + innerH}`;

      return h(
        Tooltip,
        null,
        ({ show, hide }) =>
          h(
            'svg',
            { className: 'tbi-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('viewTrend') },
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
            h('polygon', { points: areaStr, fill: 'color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent)' }),
            h('polyline', { points: lineStr, fill: 'none', stroke: 'var(--dsw-alias-state-business-primary)', strokeWidth: 2, strokeLinejoin: 'round' }),
            pts.map(([x, y, total], index) => {
              const row = rows[index];
              const isSelected = selectedDay === row.day;
              const isDimmed = selectedDay !== null && !isSelected;
              return h(
                'g',
                {
                  key: row.day,
                  style: { cursor: 'pointer', transition: 'opacity 0.15s ease', opacity: isDimmed ? 0.3 : 1 },
                  onClick: () => onSelectDay?.(isSelected ? null : row.day),
                },
                h('circle', {
                  cx: x,
                  cy: y,
                  r: isSelected ? 5.5 : 3.5,
                  fill: isSelected ? 'var(--dsw-alias-state-business-primary)' : '#fff',
                  stroke: 'var(--dsw-alias-state-business-primary)',
                  strokeWidth: 2,
                }),
                h('circle', {
                  cx: x,
                  cy: y,
                  r: 14,
                  fill: 'transparent',
                  onMouseEnter: () =>
                    show(
                      `${row.day}  ${compact(total)} tokens\n${t('legendInput')} ${exact(row.input)} · ${t('legendOutput')} ${exact(row.output)}\n${t('legendCacheRead')} ${exact(row.cacheRead)} · ${t('legendCacheWrite')} ${exact(row.cacheWrite)}\n${t('cacheShare')} ${percent(row.cacheRead ?? 0, total)}\n${row.sessions ?? 0} ${t('sessionsUnit')}\n(${t('clickToFilter')})`,
                    ),
                  onMouseLeave: hide,
                }),
                rows.length <= 20 || index % Math.ceil(rows.length / 10) === 0
                  ? h(
                      'text',
                      { className: 'tbi-axis', x, y: height - 6, textAnchor: 'middle' },
                      dayLabel(row.day),
                    )
                  : null,
              );
            }),
          ),
      );
    }

    /** Daily cumulative trajectory line & area chart. */
    function DailyCumulativeChart({ days, t, selectedDay, onSelectDay, useCalls }) {
      const width = 960;
      const height = 200;
      const padding = { top: 14, right: 12, bottom: 24, left: 44 };
      const innerW = width - padding.left - padding.right;
      const innerH = height - padding.top - padding.bottom;
      const rows = days;
      if (rows.length === 0) return h('p', { className: 'tbi-weak' }, t('empty'));

      let acc = 0;
      const cumRows = rows.map((r) => {
        acc += dayMeasure(r, useCalls);
        return { ...r, cumTotal: acc };
      });
      const max = Math.max(1, acc);
      const stepX = innerW / Math.max(1, rows.length - 1);
      const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));

      const point = (row, index) => {
        const x = padding.left + index * stepX;
        const y = padding.top + innerH - (row.cumTotal / max) * innerH;
        return [x, y];
      };

      const pts = cumRows.map((row, index) => point(row, index));
      const lineStr = pts.map(([x, y]) => `${x},${y}`).join(' ');
      const areaStr = `${padding.left},${padding.top + innerH} ${lineStr} ${padding.left + (rows.length - 1) * stepX},${padding.top + innerH}`;

      return h(
        Tooltip,
        null,
        ({ show, hide }) =>
          h(
            'svg',
            { className: 'tbi-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('viewCumulative') },
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
            h('polygon', { points: areaStr, fill: 'color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)' }),
            h('polyline', { points: lineStr, fill: 'none', stroke: 'var(--dsw-alias-state-success-primary)', strokeWidth: 2, strokeLinejoin: 'round' }),
            pts.map(([x, y], index) => {
              const row = cumRows[index];
              const isSelected = selectedDay === row.day;
              const isDimmed = selectedDay !== null && !isSelected;
              return h(
                'g',
                {
                  key: row.day,
                  style: { cursor: 'pointer', transition: 'opacity 0.15s ease', opacity: isDimmed ? 0.3 : 1 },
                  onClick: () => onSelectDay?.(isSelected ? null : row.day),
                },
                h('circle', {
                  cx: x,
                  cy: y,
                  r: isSelected ? 5.5 : 3.5,
                  fill: isSelected ? 'var(--dsw-alias-state-success-primary)' : '#fff',
                  stroke: 'var(--dsw-alias-state-success-primary)',
                  strokeWidth: 2,
                }),
                h('circle', {
                  cx: x,
                  cy: y,
                  r: 14,
                  fill: 'transparent',
                  onMouseEnter: () =>
                    show(
                      `${row.day}\n${t('cumTotal')}: ${exact(row.cumTotal)} tokens (${compact(row.cumTotal)})\n${t('dayAdded')}: ${exact(dayMeasure(row, useCalls))} tokens\n(${t('clickToFilter')})`,
                    ),
                  onMouseLeave: hide,
                }),
                rows.length <= 20 || index % Math.ceil(rows.length / 10) === 0
                  ? h(
                      'text',
                      { className: 'tbi-axis', x, y: height - 6, textAnchor: 'middle' },
                      dayLabel(row.day),
                    )
                  : null,
              );
            }),
          ),
      );
    }

    /** GitHub-style contribution calendar heatmap chart. */
    function DailyHeatmapChart({ days, t, selectedDay, onSelectDay, useCalls }) {
      const width = 960;
      const height = 166;
      const padding = { top: 22, right: 30, bottom: 28, left: 34 };
      const boxSize = 12;
      const gap = 3;
      const step = boxSize + gap; // 15px
      const WEEKS = 52; // 1 full year

      const dayMap = React.useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);

      const activeTotals = React.useMemo(() => days.map((d) => dayMeasure(d, useCalls)).filter((tot) => tot > 0), [days, useCalls]);
      const maxSpend = Math.max(1, ...activeTotals);
      const q25 = maxSpend * 0.15;
      const q50 = maxSpend * 0.4;
      const q75 = maxSpend * 0.7;

      const getLevel = (total) => {
        if (!total || total <= 0) return 0;
        if (total < q25) return 1;
        if (total < q50) return 2;
        if (total < q75) return 3;
        return 4;
      };

      const { grid, months } = React.useMemo(() => {
        const lastDayStr = days[days.length - 1]?.day || new Date().toISOString().slice(0, 10);
        const lastDate = new Date(`${lastDayStr}T12:00:00Z`);
        const endDayOfWeek = lastDate.getUTCDay();
        const daysToEndOfWeek = 6 - endDayOfWeek;
        const endDate = new Date(lastDate.getTime() + daysToEndOfWeek * 86_400_000);
        const totalDays = WEEKS * 7;
        const startDate = new Date(endDate.getTime() - (totalDays - 1) * 86_400_000);

        const weeks = [];
        const monthLabels = [];
        let curr = new Date(startDate);
        let lastMonth = -1;

        for (let w = 0; w < WEEKS; w += 1) {
          const weekDays = [];
          for (let d = 0; d < 7; d += 1) {
            const key = curr.toISOString().slice(0, 10);
            const m = curr.getUTCMonth();
            if (d === 0 && m !== lastMonth) {
              monthLabels.push({
                x: padding.left + w * step,
                month: curr.getUTCMonth() + 1,
              });
              lastMonth = m;
            }
            const data = dayMap.get(key) || { day: key, total: 0, sessions: 0 };
            weekDays.push(data);
            curr = new Date(curr.getTime() + 86_400_000);
          }
          weeks.push(weekDays);
        }
        return { grid: weeks, months: monthLabels };
      }, [days, dayMap]);

      const colors = [
        'color-mix(in srgb, var(--dsw-alias-label-primary) 7%, #ebedf0)',
        '#9be9a8',
        '#40c463',
        '#30a14e',
        '#216e39',
      ];

      const monthNamesEn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const isEnglish = t('heatLess') === 'Less';

      return h(
        Tooltip,
        null,
        ({ show, hide }) =>
          h(
            'svg',
            { className: 'tbi-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('viewHeatmap') },
            months.map((m, idx) =>
              h(
                'text',
                {
                  key: idx,
                  x: m.x,
                  y: padding.top - 6,
                  className: 'tbi-axis',
                  textAnchor: 'start',
                  fontSize: 10,
                },
                isEnglish ? monthNamesEn[m.month - 1] : `${m.month}月`,
              ),
            ),
            [
              { row: 1, label: t('dayMon') },
              { row: 3, label: t('dayWed') },
              { row: 5, label: t('dayFri') },
            ].map(({ row, label }) =>
              h(
                'text',
                {
                  key: row,
                  x: padding.left - 6,
                  y: padding.top + row * step + boxSize - 2,
                  className: 'tbi-axis',
                  textAnchor: 'end',
                  fontSize: 10,
                },
                label,
              ),
            ),
            grid.map((week, wIdx) => {
              const x = padding.left + wIdx * step;
              return h(
                'g',
                { key: wIdx },
                week.map((cell, dIdx) => {
                  const y = padding.top + dIdx * step;
                  // Under a tool filter the calendar counts requests, so the
                  // shading, the tooltip and what is clickable all use that.
                  const cellValue = dayMeasure(cell, useCalls);
                  const level = getLevel(cellValue);
                  const isSelected = selectedDay === cell.day;
                  const isDimmed = selectedDay !== null && !isSelected;
                  const tooltipText = cellValue > 0
                    ? (useCalls
                        ? `${cell.day}\n${cellValue} ${t('callsUnit')}\n(${t('clickToFilter')})`
                        : `${cell.day}\n${compact(cellValue)} tokens (${exact(cellValue)})\n${cell.sessions ?? 0} ${t('sessionsUnit')}\n(${t('clickToFilter')})`)
                    : `${cell.day}\n${t('noSpend')}`;

                  return h('rect', {
                    key: cell.day,
                    x,
                    y,
                    width: boxSize,
                    height: boxSize,
                    rx: 2,
                    ry: 2,
                    fill: colors[level],
                    stroke: isSelected ? 'var(--dsw-alias-state-business-primary)' : 'rgba(27, 31, 35, 0.08)',
                    strokeWidth: isSelected ? 2 : 1,
                    style: {
                      cursor: cell.total > 0 ? 'pointer' : 'default',
                      opacity: isDimmed ? 0.3 : 1,
                      transition: 'opacity 0.15s ease',
                    },
                    onClick: cellValue > 0 ? () => onSelectDay?.(isSelected ? null : cell.day) : undefined,
                    onMouseEnter: () => show(tooltipText),
                    onMouseLeave: hide,
                  });
                }),
              );
            }),
            h(
              'g',
              { transform: `translate(${width - padding.right - 140}, ${height - 10})` },
              h('text', { x: 0, y: 9, className: 'tbi-axis', textAnchor: 'end', fontSize: 10 }, t('heatLess')),
              colors.map((c, i) =>
                h('rect', {
                  key: i,
                  x: 6 + i * 14,
                  y: 0,
                  width: 10,
                  height: 10,
                  rx: 2,
                  ry: 2,
                  fill: c,
                }),
              ),
              h('text', { x: 6 + colors.length * 14 + 6, y: 9, className: 'tbi-axis', textAnchor: 'start', fontSize: 10 }, t('heatMore')),
            ),
          ),
      );
    }

    /**
     * One horizontal bar row: name, proportional fill, value.
     *
     * The visible label truncates (a full workspace path never fits), so the
     * hover tooltip repeats the *untruncated* identity plus the numbers. Without
     * that, the provider and the share of a long model name are unreachable.
     */
    function BarRow({ name, fullName, note, hint, value, max, selected, dimmed, onClick }) {
      const width = max > 0 ? Math.max(1.5, (value / max) * 100) : 0;
      const lines = [fullName === undefined ? name : fullName];
      // Add the short label only when it adds information (a path's tail,
      // say) rather than repeating the full id we just printed.
      if (fullName !== undefined && fullName !== name && !fullName.endsWith(name)) lines.push(name);
      if (note !== undefined) lines.push(note);
      lines.push(`${compact(value)} tokens (${exact(value)})`);
      if (hint !== undefined) lines.push(hint);
      const tooltip = lines.join('\n');
      return h(Tooltip, null, ({ show, hide }) =>
        h(
          'div',
          {
            className: 'tbi-barRow',
            'data-selected': selected === true,
            'data-dimmed': dimmed === true,
            onClick: onClick,
            onMouseEnter: () => show(tooltip),
            onMouseMove: () => show(tooltip),
            onMouseLeave: hide,
            style: onClick ? { cursor: 'pointer' } : undefined,
          },
          h('span', { className: 'tbi-barName' }, name, note === undefined ? null : h('small', null, note)),
          h('div', { className: 'tbi-barTrack' }, h('div', { className: 'tbi-barFill', style: { width: `${width}%` } })),
          h('span', { className: 'tbi-barValue' }, compact(value)),
        ),
      );
    }

    /** Turn-level bars inside an expanded session row. */
    function TurnSpark({ rows, t, offsetMinutes, initialFilter, selectedDay }) {
      // The timeline scrolls on its own once a session has many turns, but it
      // must not trap the wheel when it does not.
      const turnScrollRef = useWheelChaining();
      // The model card and the session list both honour the picked day, so the
      // expanded timeline must too — otherwise a session opened while a day is
      // selected still lists every turn it ever had, and the numbers stop
      // agreeing with the cards above it.
      const dayRows = React.useMemo(
        () => (selectedDay === null || selectedDay === undefined
          ? rows
          : rows.filter((row) => row.day === selectedDay)),
        [rows, selectedDay],
      );
      if (rows.length === 0) return h('p', { className: 'tbi-weak' }, t('detailNoRows'));
      const [showAll, setShowAll] = React.useState(false);
      const [filter, setFilter] = React.useState(initialFilter ?? 'all');
      const [descending, setDescending] = React.useState(true);

      React.useEffect(() => {
        if (initialFilter) setFilter(initialFilter);
      }, [initialFilter]);

      const modelCounts = React.useMemo(() => {
        const counts = new Map();
        let searchCount = 0;
        for (const row of dayRows) {
          if (row.kind === 'search') searchCount += 1;
          const key = row.provider ? `${row.provider}/${row.model}` : row.model || 'unknown';
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return { counts, searchCount };
      }, [dayRows]);

      const filtered = React.useMemo(() => {
        let list = dayRows;
        if (filter === '__search__') list = dayRows.filter((row) => row.kind === 'search');
        else if (filter !== 'all') {
          list = dayRows.filter((row) => {
            const key = row.provider ? `${row.provider}/${row.model}` : row.model || 'unknown';
            return key === filter;
          });
        }
        return [...list].sort((a, b) => descending ? (b.time - a.time) : (a.time - b.time));
      }, [dayRows, filter, descending]);

      // A selected day with no turns in this session is worth saying out loud,
      // rather than showing an empty timeline that looks broken.
      if (dayRows.length === 0) {
        return h('p', { className: 'tbi-weak' }, `${t('detailNoDayRows')} ${selectedDay}`);
      }

      const max = Math.max(1, ...filtered.map((row) => row.total));
      const shown = showAll || filter !== 'all' || filtered.length <= 60 ? filtered : filtered.slice(0, 60);

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'tbi-turnToolbar' },
          h(
            'div',
            { className: 'tbi-turnFilters' },
            h(
              'button',
              {
                className: 'tbi-turnFilterBtn',
                'data-active': filter === 'all',
                onClick: () => setFilter('all'),
              },
              `${t('filterModelAll')} (${dayRows.length})`,
            ),
            modelCounts.searchCount > 0
              ? h(
                  'button',
                  {
                    className: 'tbi-turnFilterBtn',
                    'data-active': filter === '__search__',
                    onClick: () => setFilter('__search__'),
                  },
                  `🔍 ${t('filterOnlySearch')} (${modelCounts.searchCount})`,
                )
              : null,
            [...modelCounts.counts.entries()].map(([m, cnt]) =>
              h(
                'button',
                {
                  key: m,
                  className: 'tbi-turnFilterBtn',
                  'data-active': filter === m,
                  onClick: () => setFilter(m),
                  title: m,
                },
                `${m} (${cnt})`,
              ),
            ),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h(
              'button',
              {
                className: 'tbi-turnShowAllBtn',
                onClick: () => setDescending(!descending),
                title: descending ? '按时间由新到旧' : '按时间由旧到新',
              },
              descending ? '↓ 最新在前' : '↑ 最早在前',
            ),
            filter === 'all' && filtered.length > 60
              ? h(
                  'button',
                  {
                    className: 'tbi-turnShowAllBtn',
                    onClick: () => setShowAll(!showAll),
                  },
                  showAll
                    ? t('showRecentSteps')
                    : t('showAllSteps').replace('{count}', String(filtered.length)),
                )
              : null,
          ),
        ),
        modelCounts.searchCount > 0 && filter === 'all'
          ? h(
              'div',
              {
                style: {
                  fontSize: '11px',
                  color: 'var(--dsw-alias-state-warning-primary)',
                  background: 'color-mix(in srgb, var(--dsw-alias-state-warning-primary) 10%, transparent)',
                  padding: '4px 10px',
                  borderRadius: 'var(--dsw-radius-xs)',
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                },
                onClick: () => setFilter('__search__'),
                title: '点击仅查看这几笔搜索调用',
              },
              h('span', null, `🔍 ${t('searchCallNotice').replace('{count}', String(modelCounts.searchCount))}`),
              h('span', { style: { textDecoration: 'underline', marginLeft: '8px' } }, t('filterOnlySearch')),
            )
          : null,
        h(
          'div',
          { className: 'tbi-turnList', ref: turnScrollRef },
          h(
            'div',
            { className: 'tbi-turnHeader' },
            h('span', null, t('detailStep')),
            h('span', null, t('detailModel')),
            h('span', null, t('detailTime')),
            h('span', null, t('detailTokens')),
            h('span', { style: { textAlign: 'right' } }, t('totalTokens')),
          ),
          shown.map((row, idx) => {
            const modelText = row.provider ? `${row.provider}/${row.model}` : row.model || t('unknownModel');
            const timeText = exactTime(row.time, offsetMinutes);
            const isSearch = row.kind === 'search';
            const isTitle = row.kind === 'title';
            const labelText = isSearch ? `🔍 ${t('kindSearch')}` : isTitle ? `📝 ${t('kindTitle')}` : `T${row.turn} · S${row.step}`;
            const typeHeader = isSearch ? `【${t('kindSearch')} (HTTP请求)】` : isTitle ? `【${t('kindTitle')}】` : '';
            const noteText = row.note ? `\n关键词: ${row.note}` : '';
            const estText = row.estimated ? ` (${t('estimated')})` : '';
            const callsText = row.apiCalls ? `\nAPI 请求次数: ${row.apiCalls} 次` : '';
            const tooltip = `${typeHeader} ${timeText}${noteText}${callsText}\n调用模型: ${modelText}\n${t('legendInput')} ${exact(row.input)} · ${t('legendOutput')} ${exact(row.output)}\n${t('legendCacheRead')} ${exact(row.cacheRead)} · ${t('legendCacheWrite')} ${exact(row.cacheWrite)}\n${t('totalTokens')} ${exact(row.total)}${estText}`;
            const rowKey = row.kind ? `${row.kind}:${row.time}:${idx}` : `${row.turn}:${row.step}:${idx}`;
            return h(
              'div',
              { className: 'tbi-turnRow', key: rowKey, title: tooltip },
              row.kind
                ? h('span', { className: 'tbi-pill', 'data-kind': row.kind }, labelText)
                : h('span', { className: 'tbi-turnLabel' }, labelText),
              h('span', { className: 'tbi-turnModel', title: modelText }, modelText),
              h('span', { className: 'tbi-turnTime' }, timeText),
              h(
                'span',
                { className: 'tbi-turnBar' },
                h('i', { className: 'tbi-turnSeg', style: { width: `${(row.input / max) * 100}%`, background: 'var(--tbi-fill-input)' } }),
                h('i', { className: 'tbi-turnSeg', style: { width: `${(row.cacheRead / max) * 100}%`, background: 'var(--tbi-fill-cache-read)' } }),
                h('i', { className: 'tbi-turnSeg', style: { width: `${(row.output / max) * 100}%`, background: 'var(--tbi-fill-output)' } }),
              ),
              h('span', { className: 'tbi-turnTotal' }, row.apiCalls && row.total === 0 ? `${row.apiCalls} req` : compact(row.total)),
            );
          }),
        ),
      );
    }
    //#endregion

    //#region page
    function TokenBiPage(props) {
      const { t } = props;
      // Read once, before the first paint: the last report for the default
      // window, if this browser still has one. `status` then says whether what
      // is on screen is already stale, which is what the header shows while the
      // rebuild is in flight.
      const [restored] = React.useState(() => readSnapshot());
      const [report, setReport] = React.useState(() => restored?.report ?? EMPTY_REPORT);
      const [status, setStatus] = React.useState(restored === undefined ? 'loading' : 'refreshing');
      const [error, setError] = React.useState(null);
      const [filter, setFilter] = React.useState('all');
      const [range, setRange] = React.useState(RANGES[1]);
      const [expanded, setExpanded] = React.useState(() => new Set());
      const [details, setDetails] = React.useState({});
      const [focusedSessionId, setFocusedSessionId] = React.useState(null);
      const [dailyView, setDailyView] = React.useState('bar');
      // The two big scrollers inside the panel. Both hand the wheel back to the
      // page once they run out of their own content.
      const tableScrollRef = useWheelChaining();
      const treeScrollRef = useWheelChaining();
      // Session-table ordering and paging. A bill with hundreds of sessions is
      // read by "which ones cost the most", not by scrolling, and the table
      // used to offer no order at all.
      const [sortBy, setSortBy] = React.useState({ key: 'last', desc: true });
      const [page, setPage] = React.useState(0);
      const [pageSize, setPageSize] = React.useState(10);
      const [selectedDay, setSelectedDay] = React.useState(null);
      const [selectedModel, setSelectedModel] = React.useState(null);
      const [selectedCwd, setSelectedCwd] = React.useState(null);
      // Session ids whose delegated children are currently shown. Empty means
      // every subagent row is folded under its parent, which is the default:
      // the point of the list is the sessions, and a parent that spawned twenty
      // children was twenty rows of noise before anything else could be read.
      const [openBranches, setOpenBranches] = React.useState(() => new Set());
      const offsetMinutes = React.useMemo(() => -new Date().getTimezoneOffset(), []);

      // The aggregate provider is a virtual route: Jet Hub forwards each call
      // to whichever real channel is next in line (expiring credits first).
      // The session log records the virtual name, so the bill shows one merged
      // row. The host does expose the real channel through its RPC, though —
      // this holds the latest answer and lets the model card say "aggregate
      // right now = <real channel>" without touching the numbers.
      const [aggregateProvider, setAggregateProvider] = React.useState(null);

      // Ask Jet Hub which real channel the aggregate route is using right now.
      // Best effort by design: when the plugin that owns the endpoint is not
      // installed (or the request races the server), the card simply shows the
      // provider name without the "现在走" note. One probe per panel open is
      // enough; the answer only changes when a request actually succeeds.
      const probeAggregateProvider = React.useCallback(async () => {
        try {
          const response = await fetch('/api/jet-hub', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              type: 'client-request',
              rpcId: `tbi-${Math.random().toString(36).slice(2, 10)}`,
              method: 'jet-hub',
              payload: { method: 'aggregate.activeProvider', payload: {} },
            }),
          });
          if (!response.ok) return;
          const envelope = await response.json();
          const provider = envelope?.result?.value?.provider;
          if (typeof provider === 'string' && provider.length > 0) setAggregateProvider(provider);
        } catch {
          // The note is decorative; never fail a page open over it.
        }
      }, []);

      React.useEffect(() => {
        // One probe per panel open, deliberately nothing else. The note is a
        // hint about the moment the bill was opened; wiring it to focus or
        // visibility would make every click in the page fire a request, which
        // is exactly the kind of idle chatter this plugin avoids.
        probeAggregateProvider();
      }, [probeAggregateProvider]);

      const load = React.useCallback(
        async () => {
          // Anything already on screen stays on screen while the read runs;
          // only a page with nothing to show falls back to the cold state. That
          // covers both the reopened panel (painted from a snapshot) and a read
          // of a panel that is already full.
          setStatus((current) => (current === 'loading' ? 'loading' : 'refreshing'));
          try {
            // Always the whole history: every window the user can pick is a
            // local slice of this one report, so no interaction can trigger a
            // second fetch.
            const query = `offset=${offsetMinutes}&days=0`;
            const response = await fetch(`${API}/report?${query}`, {
              credentials: 'same-origin',
            });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const next = await response.json();
            setReport(next);
            setError(next.errors?.length > 0 ? next.errors[0].message : null);
            setStatus('ready');
            // Keep the painted numbers one open behind at most.
            writeSnapshot(next);
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught));
            setStatus('ready');
          }
        },
        [offsetMinutes],
      );

      // Exactly one request per open. The report is fetched whole — the entire
      // history, not one window — because the panel must never reach the host
      // again while the user pokes at it: every switch, filter and click is a
      // local slice of the data already in memory. There is deliberately no
      // focus or visibility listener either; those turn ordinary interaction
      // into a forced rebuild and the page restarts under the pointer.
      //
      // The only other ways to get fresh numbers are the Refresh button and
      // reopening the panel.
      const loadRef = React.useRef(load);
      React.useEffect(() => {
        loadRef.current = load;
      }, [load]);

      React.useEffect(() => {
        // One read, at mount — the moment the panel is opened. The host answers
        // from its persistent ledger, so this is milliseconds, and there is
        // nothing to re-fetch afterwards: windows are local slices and new
        // sessions reach the ledger as they happen.
        loadRef.current();
      }, []);

      const changeRange = React.useCallback(
        (days) => {
          setRange(days);
          setExpanded(new Set());
          setDetails({});
          // No request: the whole history is already here, and the window is a
          // filter over it. A click on a preset must feel instant.
        },
        [],
      );

      const fetchSessionDetail = React.useCallback(
        (sessionId) => {
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

      const toggle = React.useCallback(
        (sessionId) => {
          setExpanded((current) => {
            const next = new Set(current);
            if (next.has(sessionId)) next.delete(sessionId);
            else next.add(sessionId);
            return next;
          });
          fetchSessionDetail(sessionId);
        },
        [fetchSessionDetail],
      );

      function smoothScrollContainer(container, targetY, duration = 450) {
        if (!container) return;
        const startY = container.scrollTop;
        const diff = targetY - startY;
        if (Math.abs(diff) < 2) {
          container.scrollTop = targetY;
          return;
        }
        const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        function step(now) {
          const elapsed = now - startTime;
          const progress = Math.min(1, elapsed / duration);
          // easeInOutCubic: smooth acceleration and gentle deceleration
          const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
          container.scrollTop = startY + diff * ease;
          if (progress < 1) {
            if (typeof requestAnimationFrame !== 'undefined') {
              requestAnimationFrame(step);
            }
          } else {
            container.scrollTop = targetY;
          }
        }
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(step);
        } else {
          container.scrollTop = targetY;
        }
      }

      /**
       * Put a session row in the middle of the viewport and flag it, so the
       * eye can find it after the jump. Returns false when the row is not in
       * the DOM at all — folded away, or filtered out.
       */
      const scrollToSessionRow = React.useCallback((sessionId) => {
        const el = document.getElementById(`session-${sessionId}`);
        if (!el) return false;
        const scrollContainer = document.querySelector('.tbi-scroll');
        if (scrollContainer) {
          const elRect = el.getBoundingClientRect();
          const contRect = scrollContainer.getBoundingClientRect();
          const targetTop = scrollContainer.scrollTop + (elRect.top - contRect.top) - (contRect.height / 2) + (elRect.height / 2);
          smoothScrollContainer(scrollContainer, Math.max(0, targetTop), 450);
        } else {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        el.classList.remove('tbi-highlightRow');
        void el.offsetWidth;
        el.classList.add('tbi-highlightRow');
        return true;
      }, []);

      /**
       * Jump from the call tree to a row in the table.
       *
       * A session can be missing from the DOM for two different reasons now,
       * and they need opposite responses: it is folded inside a parent (open
       * that branch — the user's filters are fine), or it is filtered out
       * entirely (drop the filters). Treating a folded row as a filtered one
       * would silently wipe the day/model/workspace selection the user set.
       */
      /**
       * Where a session sits in the drawn list, published for `locateSession`.
       *
       * The list is sorted and paged further down this component, but locating
       * happens above it — so the lookup goes through a ref instead of closing
       * over values that are not defined yet. It also means this callback does
       * not need rebuilding on every page turn.
       */
      const layoutRef = React.useRef({ order: [], pageSize: 10 });
      const findSessionPage = React.useCallback((sessionId) => {
        const { order, pageSize: size } = layoutRef.current;
        const index = order.indexOf(sessionId);
        return index < 0 ? -1 : Math.floor(index / size);
      }, []);

      const locateSession = React.useCallback(
        (sessionId, ancestors = []) => {
          setFocusedSessionId(sessionId);
          setTimeout(() => {
            setFocusedSessionId((curr) => (curr === sessionId ? null : curr));
          }, 3500);

          const openTimeline = () => {
            setTimeout(() => {
              setExpanded((current) => new Set([...current, sessionId]));
              fetchSessionDetail(sessionId);
            }, 300);
          };

          if (scrollToSessionRow(sessionId)) {
            openTimeline();
            return;
          }

          // On another page: turn to it and look again.
          const targetPage = findSessionPage(sessionId);
          if (targetPage >= 0) {
            setPage(targetPage);
            setTimeout(() => {
              if (scrollToSessionRow(sessionId)) openTimeline();
            }, 150);
            return;
          }

          if (ancestors.length > 0) {
            // In the list, just folded under one of its ancestors.
            setOpenBranches((current) => {
              const next = new Set(current);
              for (const id of ancestors) next.add(id);
              return next;
            });
            setTimeout(() => {
              if (scrollToSessionRow(sessionId)) openTimeline();
            }, 150);
            return;
          }

          // Not in the filtered set at all: drop what is hiding it, then look.
          setSelectedDay(null);
          setSelectedModel(null);
          setSelectedCwd(null);
          setExpanded((current) => new Set([...current, sessionId]));
          fetchSessionDetail(sessionId);
          setTimeout(() => {
            scrollToSessionRow(sessionId);
          }, 120);
        },
        [fetchSessionDetail, scrollToSessionRow, findSessionPage],
      );

      /**
       * The three facet cards filter each other, so each of them has to be
       * rebuilt from the (day, model, cwd) cross-tab with the *other two*
       * facets applied. Reading `report.models` directly would keep showing
       * every model after a day is picked.
       */
      /**
       * True when the active model filter is a billed tool rather than a real
       * model. Those report no tokens, so every token chart under that filter
       * would be flat zero; they are measured in requests instead.
       */
      const useCalls = React.useMemo(() => {
        if (selectedModel === null) return false;
        return (report.tools ?? []).some((tool) => `${tool.provider}/${tool.model}` === selectedModel);
      }, [selectedModel, report.tools]);

      /**
       * The window the page draws, cut locally from the all-time report.
       *
       * The panel never asks the host for a second window: switching 7 / 30 /
       * all is a filter over the data already in memory, so it is instant and
       * costs no request. A window means "the last N days ending today", with
       * quiet days zero-filled — the charts keep their axes either way.
       */
      const windowSlice = React.useMemo(() => {
        const allDays = Array.isArray(report.days) ? report.days : [];
        // Anchor the window on the newest day the data actually covers, not on
        // the wall clock: with a store that went quiet yesterday, "the last 7
        // days" must still end on a day that has numbers in it.
        const lastDay = allDays[allDays.length - 1]?.day;
        if (!range || range === 0) {
          return { cutoff: undefined, lastDay, days: allDays };
        }
        const todayKey = new Date(Date.now() + offsetMinutes * 60_000).toISOString().slice(0, 10);
        const anchor = lastDay ?? todayKey;
        const startMs = Date.parse(`${anchor}T00:00:00Z`) - (range - 1) * 86_400_000;
        const cutoff = new Date(startMs).toISOString().slice(0, 10);
        const rows = [];
        for (let i = 0; i < range; i += 1) {
          const day = new Date(startMs + i * 86_400_000).toISOString().slice(0, 10);
          rows.push({ day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: 0, sessions: 0 });
        }
        const byDay = new Map(allDays.map((day) => [day.day, day]));
        for (const row of rows) {
          const hit = byDay.get(row.day);
          if (hit !== undefined) Object.assign(row, hit);
        }
        return { cutoff, lastDay: rows[rows.length - 1]?.day ?? anchor, days: rows };
      }, [report.days, range, offsetMinutes]);

      const facets = React.useMemo(() => {
        const inWindow = (day) => windowSlice.cutoff === undefined || day >= windowSlice.cutoff;
        /**
         * The cells every facet is folded from.
         *
         * A selected day wins over the window: the calendar above always spans
         * the full year and is clickable all the way back to its first column,
         * so a day outside the 7/30-day preset is a perfectly legal selection.
         * Filtering to the window first made it a dead selection — the day held
         * no cells, so every card below went to zero and the click looked like
         * it had done nothing (or, worse, wiped the board).
         */
        const all = (report.cells ?? []).filter((cell) =>
          selectedDay === null ? inWindow(cell.day) : cell.day === selectedDay || inWindow(cell.day),
        );
        // Ignore a facet's own selection when rebuilding that facet.
        const matches = (cell, { day = true, model = true, cwd = true } = {}) =>
          (day === false || selectedDay === null || cell.day === selectedDay) &&
          (model === false || selectedModel === null || `${cell.provider}/${cell.model}` === selectedModel) &&
          (cwd === false || selectedCwd === null || cell.cwd === selectedCwd);

        /** Rank a facet by spend, which is the ordering models and workspaces want. */
        const fold = (list, keyOf) => {
          const map = new Map();
          for (const cell of list) {
            const key = keyOf(cell);
            let bucket = map.get(key);
            if (bucket === undefined) {
              bucket = { key, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: 0 };
              map.set(key, bucket);
            }
            bucket.input += cell.input;
            bucket.output += cell.output;
            bucket.cacheRead += cell.cacheRead;
            bucket.cacheWrite += cell.cacheWrite;
            bucket.total += cell.total;
            bucket.calls += cell.calls ?? 0;
          }
          return [...map.values()].sort((left, right) => right.total - left.total);
        };

        /**
         * Days come from `report.days`, never from the cross-tab alone: the
         * report carries the exact window (7 or 30 entries) with quiet days
         * zero-filled, whereas the cross-tab only has days that spent
         * something. Folding the cross-tab directly would collapse a 30-day
         * window down to the handful of busy days and look identical to 7.
         */
        const daySpend = new Map();
        for (const cell of all) {
          if (!matches(cell, { day: false })) continue;
          let bucket = daySpend.get(cell.day);
          if (bucket === undefined) {
            bucket = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: 0 };
            daySpend.set(cell.day, bucket);
          }
          bucket.input += cell.input;
          bucket.output += cell.output;
          bucket.cacheRead += cell.cacheRead;
          bucket.cacheWrite += cell.cacheWrite;
          bucket.total += cell.total;
          bucket.calls += cell.calls ?? 0;
        }
        /**
         * The day rows the charts and the headline consume.
         *
         * Normally the drawn window, zero-filled. When the selection is a day
         * *outside* that window (the calendar reaches back a full year), the
         * rows would otherwise never contain it and the headline would sum to
         * zero while the calendar still showed the click as active. Swap in
         * that one day instead, so the cards describe the day the reader picked.
         */
        const selectedOutsideWindow =
          selectedDay !== null && !windowSlice.days.some((day) => day.day === selectedDay);
        const daySource = selectedOutsideWindow
          ? [{ day: selectedDay, sessions: 0 }]
          : windowSlice.days;
        const forDays = daySource.map((day) => {
          const spend = daySpend.get(day.day);
          return {
            day: day.day,
            input: spend?.input ?? 0,
            output: spend?.output ?? 0,
            cacheRead: spend?.cacheRead ?? 0,
            cacheWrite: spend?.cacheWrite ?? 0,
            total: spend?.total ?? 0,
            calls: spend?.calls ?? 0,
            // The cross-tab has no session dimension, so the per-day count comes
            // from the report's own daily roll-up. Dropping it left the bar
            // tooltip saying "0 sessions" on every day.
            sessions: day.sessions ?? 0,
          };
        });

        const forModels = fold(all.filter((cell) => matches(cell, { model: false })), (cell) => `${cell.provider}/${cell.model}`)
          .map((bucket) => {
            const [provider, ...rest] = bucket.key.split('/');
            return { provider, model: rest.join('/'), input: bucket.input, output: bucket.output, cacheRead: bucket.cacheRead, cacheWrite: bucket.cacheWrite, total: bucket.total, calls: bucket.calls };
          });
        const forCwds = fold(all.filter((cell) => matches(cell, { cwd: false })), (cell) => cell.cwd)
          .map((bucket) => ({ cwd: bucket.key, input: bucket.input, output: bucket.output, cacheRead: bucket.cacheRead, cacheWrite: bucket.cacheWrite, total: bucket.total, calls: bucket.calls }));

        /**
         * Tool call counts under the current day and workspace filters.
         *
         * The report's `tools` block is a whole-window total, so it ignored the
         * day selection and the panel looked frozen when a day was picked. Fold
         * the cross-tab instead, which carries `calls` per (day, model, cwd).
         */
        const forTools = fold(
          all.filter((cell) => matches(cell, { model: false }) && (cell.calls ?? 0) > 0),
          (cell) => `${cell.provider}/${cell.model}`,
        ).map((bucket) => {
          const [provider, ...rest] = bucket.key.split('/');
          const model = rest.join('/');
          // `kind` drives the label; without it every row rendered as "search".
          const kind = model === 'tool-fetch' ? 'fetch' : 'search';
          return { provider, model, kind, calls: bucket.calls };
        });

        /**
         * Day × model totals, for the stacked-by-model column chart.
         *
         * The daily card used to stack the four cost buckets, which answers
         * "what kind of spend" — but the question a bill actually raises is
         * "whose spend". This is the same cross-tab the model card reads, kept
         * per day so a column can show which model each slice belongs to.
         *
         * Only days inside the drawn window and models that survived the other
         * facets are included, so the stack always adds up to the column.
         */
        /**
         * Day × model totals, for the stacked-by-model column chart.
         *
         * The daily card used to stack the four cost buckets, which answers
         * "what kind of spend" — but the question a bill actually raises is
         * "whose spend". This is the same cross-tab the model card reads, kept
         * per day so a column can show which model each slice belongs to.
         *
         * The model filter is deliberately **ignored** here. A model-card row
         * selects a series, and the stack is what shows that selection: the
         * chosen model keeps full colour while the others dim back. Folding the
         * filter in would leave a single-colour column and nothing to compare
         * against, which is exactly the view the filter is meant to explain.
         */
        const series = (() => {
          const windowDays = new Set(windowSlice.days.map((day) => day.day));
          const byModel = new Map();
          for (const cell of all) {
            if (!windowDays.has(cell.day)) continue;
            if (!matches(cell, { model: false })) continue;
            const key = `${cell.provider}/${cell.model}`;
            let bucket = byModel.get(key);
            if (bucket === undefined) {
              bucket = { key, provider: cell.provider, model: cell.model, total: 0, perDay: new Map() };
              byModel.set(key, bucket);
            }
            bucket.total += cell.total;
            bucket.perDay.set(cell.day, (bucket.perDay.get(cell.day) ?? 0) + cell.total);
          }
          // Ranked like the model card, so the biggest spender is the bottom
          // slice and the legend order matches what the eye reads first.
          return [...byModel.values()].sort((left, right) => right.total - left.total);
        })();

        /**
         * The same day-by-day fold as `forDays`, but over the whole report
         * rather than the preset window.
         *
         * The calendar card draws a full year regardless of the 7/30-day
         * preset, so it needs a series with the model and workspace filters
         * applied *and* every day kept. Deriving that from `forDays` was
         * impossible — `forDays` only carries the window — and feeding the
         * calendar the raw `report.days` ignored the filters entirely.
         */
        const yearly = (() => {
          const byDay = new Map();
          for (const cell of (report.cells ?? [])) {
            // The day selection is deliberately ignored: the calendar is how a
            // day gets picked, and one lit cell among zeroed ones is what shows
            // the current choice.
            if (!matches(cell, { day: false })) continue;
            let bucket = byDay.get(cell.day);
            if (bucket === undefined) {
              bucket = { day: cell.day, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: 0, sessions: 0 };
              byDay.set(cell.day, bucket);
            }
            bucket.input += cell.input;
            bucket.output += cell.output;
            bucket.cacheRead += cell.cacheRead;
            bucket.cacheWrite += cell.cacheWrite;
            bucket.total += cell.total;
            bucket.calls += cell.calls ?? 0;
          }
          // Session counts come from the report's own daily roll-up, like forDays.
          const reportDays = Array.isArray(report.days) ? report.days : [];
          return reportDays.map((day) => {
            const spend = byDay.get(day.day);
            return {
              day: day.day,
              input: spend?.input ?? 0,
              output: spend?.output ?? 0,
              cacheRead: spend?.cacheRead ?? 0,
              cacheWrite: spend?.cacheWrite ?? 0,
              total: spend?.total ?? 0,
              calls: spend?.calls ?? 0,
              sessions: day.sessions ?? 0,
            };
          });
        })();

        return { days: forDays, models: forModels, cwds: forCwds, tools: forTools, series, yearly };
      }, [report.cells, report.days, report.tools, selectedDay, selectedModel, selectedCwd, windowSlice]);

      const sessions = React.useMemo(() => {
        const inWindow = (day) => windowSlice.cutoff === undefined || day >= windowSlice.cutoff;
        // Only sessions active inside the drawn window belong in the list; the
        // report itself spans all time now, so this is the window filter.
        let rows = (report.sessions ?? []).filter((row) => (row.days ?? []).some(inWindow));
        if (filter === 'live') rows = rows.filter((row) => row.live);
        else if (filter === 'cold') rows = rows.filter((row) => !row.live);

        if (selectedDay !== null) {
          rows = rows.filter((row) => (row.days ?? []).includes(selectedDay));
        }
        if (selectedModel !== null) {
          rows = rows.filter((row) =>
            (row.models ?? []).some((m) => `${m.provider}/${m.model}` === selectedModel || m.model === selectedModel),
          );
        }
        if (selectedCwd !== null) {
          rows = rows.filter((row) => row.cwd === selectedCwd);
        }
        return rows;
      }, [report.sessions, filter, selectedDay, selectedModel, selectedCwd, windowSlice]);

      /**
       * What one session row should read under the current filters.
       *
       * Three scopes, narrowest last: the session's lifetime total, that day's
       * total, and — once a model is picked — that model's share of that day.
       * The middle one already existed; without the narrowest the table showed
       * a whole-day figure under a model filter, so the row and the model card
       * above it described different quantities.
       *
       * A model with no entry for the day means the session simply did not use
       * it that day: 0 is the honest answer, not the day total.
       */
      const sessionRowTotal = React.useCallback(
        (session) => {
          if (selectedDay !== null) {
            const forDay = session.dayModels?.[selectedDay];
            if (selectedModel !== null) {
              return forDay?.[selectedModel]?.total ?? 0;
            }
            const dayTotal = session.dayTotals?.[selectedDay]?.total;
            if (dayTotal !== undefined) return dayTotal;
          } else if (selectedModel !== null) {
            // No day picked: fall back to the session's per-model total, which
            // the report already carries.
            const hit = (session.models ?? []).find(
              (model) => `${model.provider}/${model.model}` === selectedModel,
            );
            if (hit !== undefined) return hit.total ?? 0;
          }
          return session.totals?.total ?? 0;
        },
        [selectedDay, selectedModel],
      );

      // `sessionRowTotal` narrows the bar to the day / model filter, so the tree
      // and the table cannot disagree about how big a session is.
      const forest = React.useMemo(
        () => buildForest(sessions, sessionRowTotal),
        [sessions, sessionRowTotal],
      );

      /**
       * The table's order, and the page of it on screen.
       *
       * Sorting happens on the *drawn* list; paging cuts afterwards, so the page
       * counter and "N of M" always describe the same ordering the reader
       * picked. The default is newest activity first, which is what the store
       * already returns and what a bill is usually read for.
       */
      // Folding is a drawing decision only: `forest` stays whole, so totals,
      // filters, the CSV export and the tree scale never see a shorter list.
      const visibleForest = React.useMemo(() => visibleForestRows(forest, openBranches), [forest, openBranches]);
      const sortedForest = React.useMemo(() => {
        // Sort the drawn rows, not the whole forest: a folded child must stay
        // folded under its parent, and the call tree reads this same list.
        const rows = [...visibleForest];
        const pick = {
          tokens: (row) => row.session.totals?.total ?? 0,
          turns: (row) => row.session.turns ?? 0,
          cache: (row) => {
            const total = row.session.totals?.total ?? 0;
            return total > 0 ? (row.session.totals?.cacheRead ?? 0) / total : 0;
          },
          last: (row) => Number(row.session.lastTime) || 0,
          session: (row) => String(row.session.title ?? '').toLowerCase(),
        }[sortBy.key] ?? (() => 0);
        rows.sort((left, right) => {
          const a = pick(left);
          const b = pick(right);
          const delta = typeof a === 'string' ? a.localeCompare(b) : a - b;
          return sortBy.desc ? -delta : delta;
        });
        return rows;
      }, [visibleForest, sortBy]);
      const pageCount = Math.max(1, Math.ceil(sortedForest.length / pageSize));
      const safePage = Math.min(page, pageCount - 1);
      // Publish the order for `locateSession`, which is declared above this
      // point and cannot close over it.
      layoutRef.current = {
        order: sortedForest.map((row) => row.session.id),
        pageSize,
      };
      /**
       * The page both lists draw.
       *
       * The session table and the call tree are two views of one selection: a
       * session visible in the table must be visible in the tree, on the same
       * page. They used to read different arrays — the table its page, the tree
       * the whole forest — so paging moved one and left the other showing
       * everything, and the two could describe different sessions at once.
       */
      const pageRows = React.useMemo(
        () => sortedForest.slice(safePage * pageSize, safePage * pageSize + pageSize),
        [sortedForest, safePage, pageSize],
      );

      const toggleSort = React.useCallback((key) => {
        setPage(0);
        setSortBy((current) => (current.key === key ? { key, desc: !current.desc } : { key, desc: key !== 'session' }));
      }, []);

      const foldableIds = React.useMemo(() => forest.filter((row) => row.children > 0).map((row) => row.session.id), [forest]);
      const foldedCount = React.useMemo(
        () => forest.filter((row) => row.children > 0 && !openBranches.has(row.session.id)).length,
        [forest, openBranches],
      );
      const toggleBranch = React.useCallback((sessionId) => {
        setOpenBranches((current) => {
          const next = new Set(current);
          if (next.has(sessionId)) next.delete(sessionId);
          else next.add(sessionId);
          return next;
        });
      }, []);
      const setAllBranches = React.useCallback(
        (open) => {
          setOpenBranches(open ? new Set(foldableIds) : new Set());
        },
        [foldableIds],
      );
      /**
       * Headline totals for the window on screen.
       *
       * The report carries all-time totals, and the page draws a window, so the
       * numbers have to be recounted here — otherwise switching from 30 days to
       * 7 would leave the headline unchanged while the charts shrank.
       */
      const totals = React.useMemo(() => {
        /**
         * The scope the headline numbers cover.
         *
         * With a day selected, "累计 token" must mean *that day*, not the whole
         * window: the charts below it already narrow to the day, so a headline
         * that ignored the selection read as "my click did nothing".
         *
         * The same applies to the model and workspace filters: `facets.days`
         * is already folded through them, so summing it (instead of the raw
         * window) is what keeps the cards and the charts describing one thing.
         * Summing the window here left "累计 token" at the all-model total while
         * every card below it had narrowed to a single model.
         */
        const dayRows = selectedDay === null
          ? facets.days
          : facets.days.filter((day) => day.day === selectedDay);
        const summed = dayRows.reduce(
          (acc, day) => {
            acc.input += day.input ?? 0;
            acc.output += day.output ?? 0;
            acc.cacheRead += day.cacheRead ?? 0;
            acc.cacheWrite += day.cacheWrite ?? 0;
            return acc;
          },
          { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        );
        const inScope = (day) => {
          if (selectedDay !== null) return day === selectedDay;
          return windowSlice.cutoff === undefined || day >= windowSlice.cutoff;
        };
        const rows = (report.sessions ?? []).filter((row) => (row.days ?? []).some(inScope));
        // Turns are counted per scope, and a session's turns can straddle a
        // boundary, so sum the per-turn day map instead of the session's
        // all-time count.
        let turns = 0;
        for (const row of rows) {
          const dayMap = row.turnDays;
          if (dayMap === undefined) {
            turns += Number(row.turns) || 0;
            continue;
          }
          for (const day of Object.values(dayMap)) if (inScope(String(day))) turns += 1;
        }
        return {
          ...summed,
          total: summed.input + summed.output + summed.cacheRead + summed.cacheWrite,
          sessions: rows.length,
          live: rows.filter((row) => row.live).length,
          turns,
          steps: report.totals?.steps ?? 0,
        };
      // `facets` is a dependency, not just a source: it is what carries the
      // day/model/workspace filters into the headline. Leaving it out kept the
      // cards on the unfiltered totals while every chart below had narrowed.
      }, [facets, windowSlice, report.sessions, report.totals, selectedDay]);
      const cacheShare = percent(totals.cacheRead, totals.total);
      const today = React.useMemo(() => {
        const now = new Date(Date.now() + offsetMinutes * 60_000);
        const key = now.toISOString().slice(0, 10);
        return (report.days ?? []).find((day) => day.day === key);
      }, [report.days, offsetMinutes]);

      /**
       * The model the whole panel is scoped to, or null.
       *
       * One state, not two. The chart's legend, the model card's rows and every
       * chart that reacts to a model all read and write `selectedModel`, so
       * they can never disagree about what is selected. A second "focus" copy
       * used to exist, and it produced exactly the confusion two switches
       * always produce: one lit up while the other still let the same model be
       * selected again, and neither could deselect the other.
       */
      const focusModel = selectedModel;

      const maxModel = Math.max(1, ...facets.models.map((model) => model.total));
      const maxCwd = Math.max(1, ...facets.cwds.map((cwd) => cwd.total));
      // Under a tool filter the workspaces rank by request count, so the bars
      // need that scale rather than the token one.
      const maxCwdCalls = Math.max(1, ...facets.cwds.map((cwd) => cwd.calls ?? 0));
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
                    h(Figure, {
                      // With a day selected the card reports that day, so the
                      // label says so instead of quietly shrinking "累计".
                      label: selectedDay === null ? t('totalTokens') : t('dayTokens'),
                      value: compact(totals.total),
                      unit: t('tokensShort'),
                      note: selectedDay === null
                        ? rangeNote(windowSlice.days, range, t)
                        : dayLabel(selectedDay),
                      // The compacted number is for reading; this is for pasting
                      // into a report or a bug ticket. Selectable, monospace.
                      exact: exact(totals.total),
                    }),
                    h(Figure, {
                      label: t('todayTokens'),
                      value: compact(today?.total ?? 0),
                      unit: t('tokensShort'),
                      exact: exact(today?.total ?? 0),
                    }),
                    h(Figure, { label: t('totalSessions'), value: String(totals.sessions), unit: t('sessionsUnit'), note: `${totals.live} ${t('live')}` }),
                    h(Figure, { label: t('totalTurns'), value: String(totals.turns), unit: t('turnsUnit') }),
                    h(Figure, { label: t('cacheShare'), value: cacheShare, note: `${compact(totals.cacheRead)} / ${compact(totals.total)}` }),
                  ),

                  h(
                    Card,
                    {
                      title: t('dailyTitle'),
                      hint: dailyView === 'trend' ? t('trendHint') : dailyView === 'cumulative' ? t('cumulativeHint') : t('dailyHint'),
                      aside: h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' } },
                        h(
                          'div',
                          { className: 'tbi-viewTabs' },
                          [
                            { id: 'bar', label: t('viewBar'), icon: '📊' },
                            { id: 'trend', label: t('viewTrend'), icon: '📈' },
                            { id: 'cumulative', label: t('viewCumulative'), icon: '↗' },
                          ].map((tab) =>
                            h(
                              'button',
                              {
                                key: tab.id,
                                type: 'button',
                                className: 'tbi-viewBtn',
                                'data-active': dailyView === tab.id,
                                onClick: () => setDailyView(tab.id),
                              },
                              `${tab.icon} ${tab.label}`,
                            ),
                          ),
                        ),
                        dailyView === 'bar'
                          ? useCalls
                            ? h(Legend, { t })
                            : h(ModelLegend, {
                                t,
                                series: facets.series,
                                palette: modelPalette,
                                focus: focusModel,
                                // Same switch as the model card row: a click
                                // toggles the one selection, so selecting from
                                // the legend and deselecting from the card (or
                                // the other way round) stay in step.
                                onFocus: (key) => setSelectedModel(key === selectedModel ? null : key),
                              })
                          : null,
                      ),
                    },
                    dailyView === 'trend'
                      ? h(DailyTrendChart, {
                          days: facets.days,
                          t,
                          selectedDay,
                          useCalls,
                          onSelectDay: (day) => setSelectedDay(day),
                        })
                      : dailyView === 'cumulative'
                      ? h(DailyCumulativeChart, {
                          days: facets.days,
                          t,
                          selectedDay,
                          useCalls,
                          onSelectDay: (day) => setSelectedDay(day),
                        })
                      : h(DailyChart, {
                          days: facets.days,
                          t,
                          offsetMinutes,
                          selectedDay,
                          useCalls,
                          series: facets.series,
                          palette: modelPalette,
                          focusModel,
                          onSelectDay: (day) => setSelectedDay(day),
                        }),
                  ),

                  h(
                    Card,
                    { title: t('heatmapTitle'), hint: t('heatmapHint') },
                    h(DailyHeatmapChart, {
                      // The calendar is a *year* view and says so in its hint, so
                      // it must keep all 365 columns whatever the preset is. It
                      // used to be fed `facets.days` once a model or workspace
                      // was picked, and that array is the 7/30-day window — so
                      // selecting a model silently cropped the calendar down to
                      // the window and every earlier month went blank. Feed it
                      // the folded *year* instead: same filtering, full span.
                      days: facets.yearly,
                      useCalls,
                      t,
                      selectedDay,
                      onSelectDay: (day) => setSelectedDay(day),
                    }),
                  ),

                  h(
                    'div',
                    { className: 'tbi-split' },
                    h(
                      Card,
                      { title: t('modelTitle'), hint: t('modelHint') },
                      (() => {
                        // Official tool calls cost money per request but report no
                        // tokens. Listing them among the model bars showed "0",
                        // which reads as free; they get their own block below.
                        const toolModels = new Set([...(report.tools ?? []), ...facets.tools].map((tool) => tool.model));
                        const billed = facets.models.filter(
                          (model) => model.total > 0 && !toolModels.has(model.model),
                        );
                        if (billed.length === 0) return h('p', { className: 'tbi-weak' }, t('noModel'));
                        const rows = billed.map((model) => {
                          const key = `${model.provider}/${model.model}`;
                          const isSelected = selectedModel === key;
                          // The chart's legend can isolate a model without
                          // filtering anything. When it does, the model card
                          // row lights up too, so the two lists always agree on
                          // which series is being looked at — the link has to
                          // work in both directions or one side looks broken.
                          const isFocused = focusModel === key;
                          const isDimmed = (selectedModel !== null && !isSelected)
                            || (selectedModel === null && focusModel !== null && !isFocused);
                          // aggregate is a virtual route; name the real channel it
                          // is currently riding on so the row is not read as a
                          // mystery vendor. The numbers stay merged — the session
                          // log never recorded which channel each call took.
                          const isAggregate = model.provider === 'aggregate';
                          const liveChannel = isAggregate && aggregateProvider !== null && aggregateProvider !== 'aggregate'
                            ? `${aggregateProvider} · `
                            : '';
                          return h(BarRow, {
                            key,
                            name: model.model,
                            fullName: key,
                            note: `${liveChannel}${model.provider} · ${percent(model.total, totals.total)}`,
                            hint: isAggregate ? t('aggregateHint') : `(${t('clickToFilter')})`,
                            value: model.total,
                            max: maxModel,
                            selected: isSelected || isFocused,
                            dimmed: isDimmed,
                            onClick: () => {
                              setSelectedModel(isSelected ? null : key);
                            },
                          });
                        });
                        return h(ScrollCard, {
                          t,
                          items: rows,
                          // Only a selection that lives *below* the fold pins the
                          // list open. Picking the first row, which is already
                          // visible when folded, must not spring the whole list
                          // open — that would make every click on a top row
                          // unroll a card the user never asked to expand.
                          pinnedIndex: selectedModel === null
                            ? -1
                            : billed.findIndex((model) => `${model.provider}/${model.model}` === selectedModel),
                        });
                      })(),
                      facets.tools.length === 0
                        ? null
                        : h(
                            'div',
                            { className: 'tbi-toolCalls' },
                            h('div', { className: 'tbi-toolCallsTitle' }, t('toolCallsTitle')),
                            facets.tools.map((tool) => {
                              // Selecting a tool filters the session list the same
                              // way a model does; these rows carry no tokens, so
                              // they cannot appear among the model bars.
                              const key = `${tool.provider}/${tool.model}`;
                              const isSelected = selectedModel === key;
                              const isDimmed = selectedModel !== null && !isSelected;
                              return h(
                                'div',
                                {
                                  key: tool.model,
                                  className: 'tbi-toolCallRow',
                                  'data-selected': isSelected,
                                  'data-dimmed': isDimmed,
                                  onClick: () => {
                                    setSelectedModel(isSelected ? null : key);
                                  },
                                  role: 'button',
                                  tabIndex: 0,
                                  onKeyDown: (event) => {
                                    if (event.key === 'Enter' || event.key === ' ') {
                                      event.preventDefault();
                                      setSelectedModel(isSelected ? null : key);
                                    }
                                  },
                                },
                                h('span', { className: 'tbi-toolCallName' }, tool.kind === 'fetch' ? t('toolFetch') : t('toolSearch')),
                                h('span', { className: 'tbi-toolCallCount' }, `${tool.calls} ${t('callsUnit')}`),
                              );
                            }),
                            h('div', { className: 'tbi-toolCallsHint' }, t('toolCallsHint')),
                          ),
                    ),
                    h(
                      Card,
                      { title: t('cwdTitle') },
                      facets.cwds.length === 0
                        ? h('p', { className: 'tbi-weak' }, t('empty'))
                        : h(ScrollCard, {
                            t,
                            // Workspace paths are longer and a bill is usually
                            // read workspace-first, so this list opens deeper
                            // than the model one before it rolls up.
                            folded: 15,
                            pinnedIndex: selectedCwd === null
                              ? -1
                              : facets.cwds.findIndex((cwd) => cwd.cwd === selectedCwd),
                            items: facets.cwds.map((cwd) => {
                              const isSelected = selectedCwd === cwd.cwd;
                              const isDimmed = selectedCwd !== null && !isSelected;
                              return h(BarRow, {
                                key: cwd.cwd,
                                name: cwd.cwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/') || cwd.cwd,
                                fullName: cwd.cwd,
                                note: useCalls ? `${cwd.calls ?? 0} ${t('callsUnit')}` : percent(cwd.total, totals.total),
                                hint: `(${t('clickToFilter')})`,
                                value: useCalls ? (cwd.calls ?? 0) : cwd.total,
                                max: useCalls ? maxCwdCalls : maxCwd,
                                selected: isSelected,
                                dimmed: isDimmed,
                                onClick: () => setSelectedCwd(isSelected ? null : cwd.cwd),
                              });
                            }),
                          }),
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
                        foldAllButton({ t, foldableIds, foldedCount, setAllBranches }),
                      ),
                    },
                    (selectedDay !== null || selectedModel !== null || selectedCwd !== null)
                      ? h(
                          'div',
                          { className: 'tbi-filterBar' },
                          h('span', { className: 'tbi-filterBarLabel' }, `${t('activeFilters')}:`),
                          selectedDay !== null
                            ? h(
                                'span',
                                { className: 'tbi-filterTag' },
                                `📅 ${t('filterDay')}: ${selectedDay}`,
                                h('button', { className: 'tbi-filterTagClose', onClick: () => setSelectedDay(null), title: '清除' }, '×'),
                              )
                            : null,
                          selectedModel !== null
                            ? h(
                                'span',
                                { className: 'tbi-filterTag' },
                                `🤖 ${t('filterModel')}: ${selectedModel}`,
                                h('button', { className: 'tbi-filterTagClose', onClick: () => setSelectedModel(null), title: '清除' }, '×'),
                              )
                            : null,
                          selectedCwd !== null
                            ? h(
                                'span',
                                { className: 'tbi-filterTag' },
                                `📁 ${t('filterCwd')}: ${selectedCwd.split(/[\\/]/).filter(Boolean).slice(-2).join('/') || selectedCwd}`,
                                h('button', { className: 'tbi-filterTagClose', onClick: () => setSelectedCwd(null), title: '清除' }, '×'),
                              )
                            : null,
                          h(
                            'button',
                            {
                              className: 'tbi-filterClearBtn',
                              onClick: () => {
                                setSelectedDay(null);
                                setSelectedModel(null);
                                setSelectedCwd(null);
                              },
                            },
                            t('clearAllFilters'),
                          ),
                        )
                      : null,
                    h(
                      'div',
                      { className: 'tbi-scrollBody', ref: tableScrollRef },
                      h(
                        'table',
                        { className: 'tbi-table' },
                        h(
                          'thead',
                          null,
                          h(
                            'tr',
                            null,
                            h('th', { className: 'tbi-sortable', 'data-sort': sortBy.key === 'session' ? (sortBy.desc ? 'desc' : 'asc') : null, onClick: () => toggleSort('session') }, t('columnSession'), sortCaret(sortBy.key === 'session', sortBy.desc)),
                            h('th', { className: 'tbi-sortable', 'data-align': 'right', 'data-sort': sortBy.key === 'tokens' ? (sortBy.desc ? 'desc' : 'asc') : null, onClick: () => toggleSort('tokens') }, t('columnTokens'), sortCaret(sortBy.key === 'tokens', sortBy.desc)),
                            h('th', { className: 'tbi-sortable', 'data-align': 'right', 'data-sort': sortBy.key === 'turns' ? (sortBy.desc ? 'desc' : 'asc') : null, onClick: () => toggleSort('turns') }, t('columnTurns'), sortCaret(sortBy.key === 'turns', sortBy.desc)),
                            h('th', { className: 'tbi-sortable', 'data-align': 'right', 'data-sort': sortBy.key === 'cache' ? (sortBy.desc ? 'desc' : 'asc') : null, onClick: () => toggleSort('cache') }, t('columnCache'), sortCaret(sortBy.key === 'cache', sortBy.desc)),
                            h('th', { className: 'tbi-sortable', 'data-align': 'right', 'data-sort': sortBy.key === 'last' ? (sortBy.desc ? 'desc' : 'asc') : null, onClick: () => toggleSort('last') }, t('columnLast'), sortCaret(sortBy.key === 'last', sortBy.desc)),
                          ),
                        ),
                        h(
                          'tbody',
                          null,
                          forest.length === 0
                            ? h('tr', null, h('td', { colSpan: 5, className: 'tbi-weak' }, t('empty')))
                            : pageRows.map(({ session, depth, children, childTotal }) => {
                                const open = expanded.has(session.id);
                                const branchOpen = openBranches.has(session.id);
                                const detail = details[session.id];
                                // With a day selected, the row must show that day's
                                // amount, not the session's lifetime total, or the
                                // table contradicts the cards above it. With a model
                                // selected too, it must show that model's share of the
                                // day — a day total under a model filter contradicts
                                // the model card instead.
                                const total = sessionRowTotal(session);
                                return h(
                                  React.Fragment,
                                  { key: session.id },
                                  h(
                                    'tr',
                                    {
                                      id: `session-${session.id}`,
                                      'data-clickable': 'true',
                                      'data-focused': focusedSessionId === session.id,
                                      onClick: () => toggle(session.id),
                                    },
                                    h(
                                      'td',
                                      null,
                                      h(
                                        'div',
                                        {
                                          className: 'tbi-sessionName',
                                          style: depth > 0 ? { paddingLeft: `${depth * 22}px` } : undefined,
                                        },
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
                                          ? h('span', { className: 'tbi-treeBranch', title: t('subagent') }, `${'│  '.repeat(Math.max(0, depth - 1))}└─ `)
                                          : null,
                                        h('span', { className: 'tbi-sessionTitle', title: session.title }, session.title),
                                        children > 0
                                          ? h(
                                              'button',
                                              {
                                                type: 'button',
                                                className: 'tbi-foldBtn',
                                                'data-open': branchOpen,
                                                'aria-expanded': branchOpen,
                                                'aria-label': `${children} ${t('subagent')}`,
                                                title: `${children} ${t('subagent')} · ${compact(childTotal)} ${t('tokensShort')} — ${branchOpen ? t('foldChildren') : t('unfoldChildren')}`,
                                                // The row itself opens the turn timeline; folding the
                                                // branch must not also do that.
                                                onClick: (event) => {
                                                  event.stopPropagation();
                                                  toggleBranch(session.id);
                                                },
                                              },
                                              h(
                                                'svg',
                                                { className: 'tbi-foldCaret', viewBox: '0 0 12 12', width: 10, height: 10, 'aria-hidden': 'true' },
                                                h('path', { d: 'M4 2.5 8 6l-4 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
                                              ),
                                              // Spelled out, not just the number: a bare "5"
                                              // beside a title reads as anything at all.
                                              `${children} ${t('subagent')}`,
                                            )
                                          : null,
                                        session.live ? h('span', { className: 'tbi-pill', 'data-live': true }, t('live')) : null,
                                        depth > 0 ? h('span', { className: 'tbi-pill', 'data-sub': true }, t('subagent')) : null,
                                      ),
                                    ),
                                    h('td', { 'data-align': 'right', className: 'tbi-num' }, compact(total)),
                                    h('td', { 'data-align': 'right', className: 'tbi-num' }, String(session.turns)),
                                    h('td', { 'data-align': 'right', className: 'tbi-num tbi-weak' }, percent(session.totals?.cacheRead ?? 0, total)),
                                    h('td', { 'data-align': 'right', className: 'tbi-weak' }, relative(session.lastTime, t)),
                                  ),
                                  open
                                    ? h(
                                        'tr',
                                        { className: 'tbi-detailRow' },
                                        h(
                                          'td',
                                          {
                                            colSpan: 5,
                                            // Start where the session name starts
                                            // (cell padding + the row's indent) so a
                                            // subagent's timeline reads as nested.
                                            style: {
                                              paddingLeft: `calc(var(--tbi-cell-pad, 10px) + ${depth * 22}px)`,
                                            },
                                          },
                                          h(
                                            'div',
                                            { className: 'tbi-detail', 'data-nested': depth > 0 },
                                            detail === undefined || detail === null
                                              ? h('p', { className: 'tbi-weak' }, t('loading'))
                                              : h(TurnSpark, {
                                                  rows: detail.rows ?? [],
                                                  t,
                                                  offsetMinutes,
                                                  initialFilter: selectedModel,
                                                  selectedDay,
                                                }),
                                          ),
                                        ),
                                      )
                                    : null,
                                );
                              }),
                        ),
                      ),
                    ),
                    // Paging: the table shows one page at a time, and the
                    // counter names the slice so a reader never wonders whether
                    // the list is complete.
                    sortedForest.length <= pageSize
                      ? null
                      : h(
                          'div',
                          { className: 'tbi-pager' },
                          h('button', {
                            type: 'button',
                            className: 'tbi-pagerBtn',
                            disabled: safePage === 0,
                            onClick: () => setPage(Math.max(0, safePage - 1)),
                          }, '‹'),
                          h('span', { className: 'tbi-pagerLabel' },
                            `${safePage * pageSize + 1}–${Math.min(sortedForest.length, (safePage + 1) * pageSize)} / ${sortedForest.length}`),
                          h('button', {
                            type: 'button',
                            className: 'tbi-pagerBtn',
                            disabled: safePage >= pageCount - 1,
                            onClick: () => setPage(Math.min(pageCount - 1, safePage + 1)),
                          }, '›'),
                          h(
                            'select',
                            {
                              className: 'tbi-pagerSize',
                              value: String(pageSize),
                              onChange: (event) => {
                                setPageSize(Number(event.target.value));
                                setPage(0);
                              },
                            },
                            [10, 50, 100].map((size) => h('option', { key: size, value: String(size) }, `${size} / ${t('pageUnit')}`)),
                          ),
                        ),
                  ),

                  h(
                    Card,
                    {
                      title: t('treeTitle'),
                      hint: t('treeHint'),
                      aside: h('div', { className: 'tbi-tools' }, foldAllButton({ t, foldableIds, foldedCount, setAllBranches })),
                    },
                    h(
                      'div',
                      { className: 'tbi-tree', ref: treeScrollRef },
                      // The same rows the table drew, in the same order: the
                      // tree is a second view of one selection, not an
                      // independent list. Paging the table pages this too, so
                      // the two can never describe different sessions.
                      pageRows.map(({ session, depth, own, childTotal, children: kids, ancestors }) =>
                        h(
                          'div',
                          {
                            className: 'tbi-treeRow',
                            key: session.id,
                            'data-depth': depth,
                            style: depth > 0 ? { paddingLeft: `${depth * 20}px` } : undefined,
                            onClick: () => locateSession(session.id, ancestors),
                            title: t('locateSession'),
                          },
                          h(
                            'div',
                            { className: 'tbi-treeLabel' },
                            h('span', { className: 'tbi-treeBranch', 'aria-hidden': 'true' }, depth === 0 ? '● ' : `${'│  '.repeat(Math.max(0, depth - 1))}└─ `),
                            h('span', { className: 'tbi-treeName', title: session.title }, session.title),
                            kids > 0
                              ? h(
                                  'button',
                                  {
                                    type: 'button',
                                    className: 'tbi-foldBtn',
                                    'data-sub': true,
                                    'data-open': openBranches.has(session.id),
                                    'aria-expanded': openBranches.has(session.id),
                                    title: `${kids} ${t('subagent')} · ${compact(childTotal)} ${t('tokensShort')} — ${openBranches.has(session.id) ? t('foldChildren') : t('unfoldChildren')}`,
                                    // The row locates the session; the pill only folds.
                                    onClick: (event) => {
                                      event.stopPropagation();
                                      toggleBranch(session.id);
                                    },
                                  },
                                  h(
                                    'svg',
                                    { className: 'tbi-foldCaret', viewBox: '0 0 12 12', width: 10, height: 10, 'aria-hidden': 'true' },
                                    h('path', { d: 'M4 2.5 8 6l-4 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
                                  ),
                                  `${kids} ${t('subagent')}`,
                                )
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
                            h('span', { className: 'tbi-barValue' }, compact(sessionRowTotal(session))),
                          ),
                        ),
                      ),
                    ),
                  ),

                  h(
                    'div',
                    { className: 'tbi-foot' },
                    // When the numbers on screen came from the snapshot, say so
                    // — "Aggregated at 23:41" over a page that is rebuilding
                    // reads as if that were already current.
                    h(
                      'span',
                      null,
                      status === 'refreshing'
                        ? `${t('snapshotAt')} ${timeLabel(report.generatedAt, offsetMinutes)} · ${t('refreshing')}`
                        : `${t('generatedAt')} ${timeLabel(report.generatedAt, offsetMinutes)}`,
                    ),
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
      // Exposed for the render test: the wheel rule is pure, and the test
      // harness has no layout to drive it through a real listener.
      wheelIntent,
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
