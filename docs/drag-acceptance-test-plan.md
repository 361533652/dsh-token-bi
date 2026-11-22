# 卡片拖拽重排 · 可验收测试方案

> 针对 `lib/client.js` 里 `SortableFigures`（顶部 8 张卡片的拖拽重排）。
> 结论先说：**现有 `test/render.mjs` 结构上不可能验证拖拽**，因为它没有布局。
> 本文给出替代方案，并且它已经在真实浏览器里跑出了 7 条失败断言 —— 全部是真 bug。

---

## 1. 为什么旧测试必然绿

`test/render.mjs` 用一个手写的 React 替身遍历元素树，没有 DOM、没有样式、没有布局。它对拖拽只做了两类断言：

| 旧断言 | 实际验证的东西 | 为什么不够 |
| --- | --- | --- |
| `typeof tile.props.onMouseDown === 'function'` | 源码里挂了事件处理函数 | 挂了 ≠ 能用 |
| 按下后 `style.transform` 字符串里有 `translate` | 内联样式被赋值了 | 赋值 ≠ 画出来 |
| `moveBody.includes('swapAdjacent(')` | 某个函数体里有这个子串 | 字符串搜索，不是行为 |
| `swapBody.includes('toIndex > fromIndex ? 1 : -1')` | 源码里写了这个三元表达式 | 同上 |

这些是**源码断点**（"代码里有没有这段字"），不是**行为断言**（"用户看到什么"）。

关键点在于：在无布局环境里 `getBoundingClientRect()` 返回全 0，`translate(x, y)` 落在一个没人绘制的节点上。**它能证明的全部内容只有"某个字符串存在"**。所以六次"测试全绿但用户说坏的"不是测试跑错了，是测试**根本没在测那件事**。

本方案的核心原则：**每一条断言都必须能在错误实现上失败。** 下面第 6 节用变异测试证明了这一点（同一套断言，坏代码 7 红 / 好代码 0 红）。

---

## 2. 方案总览

三层，从便宜到昂贵：

```
第 1 层  test/render.mjs        源码断点（保留，但降级为"冒烟"，不许再宣称验证了拖拽）
第 2 层  test/drag.mjs          真实浏览器 · 真指针 · 真布局   ← 验收闸门
第 3 层  人眼截图               拖拽中/拖拽后各一张，作为发布前人工确认
```

文件结构：

```
test/
  drag.mjs                  验收套件（断言全在这里）
  browser/
    harness.mjs             起本地 HTTP 服务，真 React 18 + 真 CSS 渲染 client.js
    drag.mjs                指针驱动 + 页面内采样器
    fixture.mjs             确定性报表数据（不依赖本机会话库）
```

运行：

```bash
node test/drag.mjs                  # 全部场景
node test/drag.mjs --only=swap      # 只跑某个场景
node test/drag.mjs --report=out.json
```

依赖：`playwright-core` + 本机已装的 Chrome/Edge（不下载浏览器）。用 `TBI_CHROME` 可指定可执行文件。

---

## 3. 如何在真实浏览器里驱动指针

### 3.1 把 client.js 跑起来

`lib/client.js` 是 DSH 的客户端插件，顶层调 `window.__ModuleLoader__.load({...})`。测试页必须复现 Host 提供的三样东西：

1. `__ModuleLoader__`（**必须在 client.js 之前定义**，否则页面静默死亡）；
2. `ctx.locale` / `ctx.slots` 注册表；
3. 同源的 `/api/dsh-token-bi/*`（`fetch` 要带 `credentials: 'same-origin'`，所以必须同源起 HTTP 服务，不能用 `file://`）。

其余全部是真的：真 React 18 UMD、真 `document`、真 CSS（含 `--dsw-*` 设计令牌，布局几何就来自它们）。

### 3.2 驱动指针

用 Playwright 的 `page.mouse`，走 Chrome 自己的输入管线，产生 **trusted** 事件：

```js
await page.mouse.move(start.x, start.y);
await page.mouse.down();
await page.mouse.move(target.x, target.y, { steps: 12 });
await page.mouse.up();
```

两个必须注意的点：

**① `steps` 不是装饰。** 一次 `mouse.move(A → C)` 是单个事件。只对最终位置做反应的实现，和每跨一个格子就交换的实现，结果**看起来一模一样**。人手会产生几十个 `mousemove`，所以测试也要产生几十个。

**② 长距离拖动要分段采样（chunk）。** `{ steps: n }` 在 Chrome 内部插值，测试只看得到终点。想抓"换过去又换回来"的震荡，必须把一段路拆成多个 chunk，每个 chunk 后采一次样：

```js
// test/drag.mjs
const press = await dragThrough(page, {
  label: '累计 token',
  waypoints: [{ x: c1.x, y: c1.y }, { x: c2.x, y: c2.y }, { x: c3.x, y: c3.y }],
  steps: 10,
  chunk: 2,      // 每 2 步采一次样 → 一段路能看到 5 个中间状态
  holdMs: 90,    // 每个路点停 90ms，抓"指针不动但卡片自己动"
});
```

### 3.3 采样时机（很容易搞错）

React 对连续事件（`mousemove`）的状态更新**不在离散通道**，可能在移动后的下一帧才提交。所以"移完立刻读"读到的可能是上一帧的位置，会把"滞后一帧"误判成"卡住"。

套件里统一用 `settle()`：**先读一次布局属性强制 flush，再等两帧**。

```js
settle() {
  return new Promise((resolve) => {
    document.querySelector('.tbi-figures').getBoundingClientRect(); // flush
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}
```

另外，**松手后要等动画停**。`.tbi-figureTile` 有 `transition: transform .18s`，`mouseup` 之后还有约 180ms 的缩放回弹。中途读位置会把动画当成"重排"：

```js
// 连续 3 帧指纹不变 = 停了；超过 1200ms = 永不停止，直接判失败
await page.evaluate(() => window.__TBI_DRAG__.settleStable({ maxMs: 1200, quietFrames: 3 }));
```

---

## 4. 应断言哪些可观测结果

### 4.1 用 `getBoundingClientRect()`，不是 `style.transform`

这是整套方案最关键的一条。

- `el.style.transform` → 读的是**内联样式字符串**。赋值了不代表画出来了。旧测试就死在这里。
- `getComputedStyle(el).transform` → 读**计算后的矩阵**，但仍是样式层。
- `el.getBoundingClientRect()` → 读**绘制后的盒子**，transform 已经生效。**这才是用户看到的。**

三者关系，用本仓库的真实数据举例：

```
按下后位移 40px：  transform: matrix(1.04,0,0,1.04,40,25)   rect.left 95.63 → 135.63  (+40.00)  ✓ 跟手
换位一次之后：      transform: matrix(1.04,0,0,1.04,289,0)   offsetLeft: 101 → 270        ✗ 但画在 384
                   └─ translate 值没变，layout 位置变了，两者叠加 → 卡片跑到指针右边一整格
```

### 4.2 四类断言

**A. 跟手（tracking）** —— 指针动 N 像素，绘制盒子也动 N 像素。

只在小位移（不跨格子）内测，避免换位干扰：

```js
最强偏差 = max(|实际位移 - 指针位移|)   // 门槛 ≤ 2px（实测 0.00px）
```

这条直接否掉"只缩放不动"那种假拖动——那种实现里位移恒为 0。

**B. 顺序（order）** —— 绘制顺序变化，且在**拖动过程中**变化。

不要只测松手后的最终顺序（那证明不了"拼图式实时交换"，只能证明"松手时算了一次"）：

```js
在 gesture 结束前采样到的 order 序列里，必须至少有一个样本（不是最后一个）已经和起始不同
```

**C. 动画与状态（animation / state）**

| 断言 | 观测点 | 门槛 |
| --- | --- | --- |
| 抬起的那张有阴影 | `getComputedStyle().boxShadow !== 'none'` | — |
| z-index 抬升 | `zIndex > 0` | 实测 30 |
| 光标变抓手 | `cursor === 'grabbing'` | — |
| **被拖的卡片自身不带过渡** | `transition-property === 'none'` 或 `duration === 0s` | 否则会拖影/滞后 |
| 网格进入排序态 | `.tbi-figures` 的 `data-sorting === 'true'` | — |
| 松手后全部复位 | 所有 tile `transform === 'none'` | — |
| **松手后不再动** | 连续帧指纹一致 | 3 帧稳定 |

关于"不带过渡"：普通 tile 是 `transition: transform .18s`，被拖的那张必须覆盖成 `none`。否则指针已经走了 200px，卡片还在 180ms 的缓动里追——观感就是"黏"。

**D. 几何不变量（invariants）** —— 不依赖具体像素的硬约束：

```js
槽位索引单调：(只往右拖) 索引只能不增或 +1，绝不出现 -1
单步位移：    每个被越过的卡片恰好位移 1 格（swap），不是被顺推（insert）
不越界：      抬起卡片的绘制右边缘 ≤ 网格右边缘 + 缩放溢出（1.04 → 2% 宽）
```

`swap` vs `insert` 用**不变量**判，比数"动了几个"稳：

```js
未经过的卡片：索引必须原地不动      // insert（splice）会把后面整段推一格，这里必红
经过的卡片：  位移必须恰好 = 1 格
```

---

## 5. 如何覆盖"连续拖动多个格子"

这是原需求里最容易漏的，也是本次抓到最多 bug 的地方。三个手段缺一不可：

### 5.1 分段采样（`chunk`）

```js
steps: 10, chunk: 2   // 一段路 → 5 个采样点
```

实测输出（当前有 bug 的代码，`chunk: 2` 即每 2 步采一次样）：

```
采样  指针X   被拖卡片槽位
  0    505        1
  1    613        1
  2    648        2
  3    756        2
  4    792        1     ← 反向了
  5    828        1
  6    864        1
  7    936        3     ← 跳了 2 格
  8    972        7     ← 跳了 4 格
```

**只有分段采样能看出 1 → 2 → 1 → 3 → 7 这个序列。** 只测终点顺序的话，最终结果 `累计花费 今日消耗 今日花费 累计 token`（索引 3）看起来完全正常——这正是六次修复都没解决的原因。

> 注：实际运行中轨迹略有浮动（有时是 `1 → 0` 后退，有时是 `+2` 跳格），因为重测槽位的时机受帧调度影响。断言因此不锁死具体序列，只锁三条不变量：**只进 1 格、不后退、不越界**。

### 5.2 指针静止观察（`holdMs`）

每个路点后让指针**停住**，同时逐帧采样：

```js
若 90ms 内出现两种以上不同 order → 判"指针不动但卡片自己换位"
```

这条区分了"和指针有关"与"自己在循环"。当前的 `swapBusy` + 重测槽位机制在被测代码里就有震荡风险。

### 5.3 单调性断言

把"只往右拖"变成可断言的硬约束：

```js
const series = trace.map(row => row.order.indexOf(target));
const backwards = series.filter((v, i) => i > 0 && v < series[i-1]);
check('tile never moves backwards while pointer only moves forwards', backwards.length === 0);
```

当前代码：`went backwards 1x: 0 → … → 1 → 1 → 1 → 0 → …` — 红。

---

## 6. 变异测试：证明断言真的能红也能绿

> 一组断言若无法在正确实现上变绿，它就只是在骂人。

做法：把修复打进一份 `lib/client.js` 副本，让 harness 指向它（`startHarness({ clientPath })`），同一套断言跑两遍。

修复内容（两处，都在 `SortableFigures`）：

```js
// 1) 绘制原点用"当前所在槽位"，不是"按下时的槽位"
const slot = slots.current[index] ?? null;
const originLeft = slot === null ? drag.originLeft : slot.left;
const originTop  = slot === null ? drag.originTop  : slot.top;
style.transform = `translate(${drag.x - originLeft}px, ${drag.y - originTop}px) scale(1.04)`;

// 2) 交换后不再重新 measure() 槽位矩形
//    槽位是"位置"，位置没动，只有卡片换了；重测会让指针落回刚离开的槽 → 震荡
window.requestAnimationFrame(() => { swapBusy.current = false; });
```

结果：

| 被测代码 | 断言结果 |
| --- | --- |
| 当前 `HEAD`（有 bug） | **55 / 62 通过**，7 条红 |
| 打了上述修复 | **62 / 62 通过** |
| 连续跑 3 次 | 结果完全一致（pass/fail 数不变） |

这证明：这批断言**不是"永远红"**，也不是**"永远绿"**，它在差别处翻转。

---

## 7. 断言清单（62 条）

### `idle` — 静止态（9 条）
| # | 断言 | 门槛 |
| --- | --- | --- |
| 1 | 绘制出 8 张可拖卡片 | = 8 |
| 2 | 网格 4 个真实列 | 前 4 张 left 互不相同 |
| 3 | 第二行在第一行下方 | row2.top > max(row1.top) |
| 4 | 每张有非零绘制盒 | w>40 且 h>40 |
| 5 | 手势前无卡片处于抬起态 | dragging=0 且 sorting≠'true' |
| 6 | 样式已生效 | 静止卡片 `cursor === 'grab'` |
| 7 | 静止时不写 layout | writes = 0 |
| 8 | 无运行时错误 | console 错误 = 0（过滤插件自己的 breadcrumb） |
| 9 | 页面无未捕获异常 | pageerror = 0 |

### `press` — 按下与空放（12 条）
| # | 断言 | 门槛 / 实测 |
| --- | --- | --- |
| 10 | 恰好抬起 1 张 | = 1 |
| 11 | 抬起的是指针下那张 | 标签相等 |
| 12 | 网格进入排序态 | `data-sorting === 'true'` |
| 13 | 层级抬升 | z-index=30 |
| 14 | 光标变抓手 | `grabbing` |
| 15 | 有抬起阴影 | box-shadow ≠ none |
| 16 | **被拖者自身无过渡** | transition-property=none |
| 17 | 按下不改变顺序 | order 全等 |
| 18 | **按下-松手不改变顺序** | order 全等 |
| 19 | **按下-松手不写 layout** | writes = 0 |
| 20 | 松手后全部复位 | dragging=0 且 sorting≠'true' |
| 21 | 松手后位置不动 | 全部 left/top 全等 |

### `track` — 跟手（3 条）
| # | 断言 | 门槛 |
| --- | --- | --- |
| 22 | **格内一对一跟手** | 最强偏差 ≤ 2px（实测 0.00） |
| 23 | 格内不触发重排 | order 不变 |
| 24 | **transform 是位移不是纯缩放** | matrix 的 m41/m42 ≠ 0 |

### `swap` — 单格交换，左右各一遍（14 条：每方向 7 条）
| # | 断言 | 门槛 / 实测 |
| --- | --- | --- |
| 25 | 跨越时**在手势中**交换 | 采样时索引已变 |
| 26 | 邻居移到让出的槽 | 索引 = from |
| 27 | **交换后仍在指针下** | 圆心偏差 ≤ 35% 槽宽（实测 270px，槽宽 268.75 → 红） |
| 28 | 松手保持顺序 | 索引 = to |
| 29 | layout 恰好写 1 次 | = 1 |
| 30 | 松手后不再动 | 观测帧内 order 唯一（实测 53 帧 1 种） |
| 31 | 松手后无残留抬起态 | dragging=0 |
| 32-38 | `left` 方向重复上述 7 条 | 交换后跟手同样为红（-269.63px） |

### `multi` — 连续跨 3 格（10 条）
| # | 断言 | 门槛 / 实测 |
| --- | --- | --- |
| 34 | **每次只进 1 格，不跳不退** | 步长 ∈ {0, 1}（实测出现 -1 → 红） |
| 35 | 顺序在**手势过程中**变 | 非末尾样本已变 |
| 36 | **跨所有交换仍跟手** | ≤ 35% 槽宽（实测 809.63px → 红） |
| 37 | **不越出网格被裁掉** | ≤ 槽宽×2%+2px（实测 813.38px → 红） |
| 38 | 指针静止时板子静止 | 每种 order 唯一（实测 45 帧 1 种） |
| 39 | 单调性：不后退 | backwards = 0（实测 1 次 → 红） |
| 40 | 3 次跨越 = 3 次相邻交换 | 最终索引 = 3 |
| 41 | 松手保持手势建立的顺序 | order 全等 |
| 42 | 持久化顺序 = 绘制顺序 | 8 个 id |
| 43 | 松手后无残留 translate | 全部 'none' |

### `vertical` — 跨行（5 条）
| # | 断言 | 门槛 / 实测 |
| --- | --- | --- |
| 44 | 落到目标槽 | 索引 = 7 |
| 45 | **未经过的卡片原地不动**（swap 而非 insert） | 0 个无关卡片位移 |
| 46 | 经过的卡片各位移恰好 1 格 | 全为 1 |
| 47 | 跨行仍跟手 | ≤ 35% 宽/高（实测 x=539 → 红） |
| 48 | 跨行顺序在松手后保留 | 索引 = 7 |

### `persist` — 持久化（6 条）
| # | 断言 | 门槛 |
| --- | --- | --- |
| 49 | 重排后写入 layout 端点 | 8 个 id |
| 50 | 写入顺序 = 绘制顺序 | id 序列相等 |
| 51 | **带写入顺序重新加载，绘制结果一致** | order 全等 |
| 52 | 挂载只读 1 次 layout | reads = 1 |
| 53 | **旧顺序缺卡片时新卡片仍出现** | 8 张（存储只有 2 个 id） |
| 54 | 旧顺序作为前缀被尊重 | 前 2 位一致 |

### `responsive` — 窄窗（3 条）
| # | 断言 | 门槛 |
| --- | --- | --- |
| 55 | 窄窗 2 列 | 前 4 张 left 只有 2 种 |
| 56 | 2 列下交换可用 | 索引 = 1 |
| 57 | 2 列下持久化 1 次 | = 1 |

**合计 62 条**：idle 9 + press 12 + track 3 + swap 14 + multi 10 + vertical 5 + persist 6 + responsive 3。

---

## 8. 当前实测结果（未修代码）

```
55 / 62 通过，10.5s
```

**7 条红，全部是真实缺陷：**

```
[swap]      [right] 交换后仍在指针下        圆心偏差 270.13px（槽宽 268.75px）
[swap]      [left]  交换后仍在指针下        圆心偏差 -269.63px
[multi]     每次只进 1 格，不跳不退         出现步长 -1：0…1→0…3
[multi]     跨所有交换仍跟手                最强偏差 809.63px（容差 94.06px）
[multi]     不越出网格                     溢出 813.38px（容差 7.38px），6/16 采样越界
[multi]     单调性：不后退                  后退 1 次
[vertical]  跨行仍跟手                      gap x=539.63 y=117.00
```

### 根因（用几何数据定位）

`.tbi-figures` 是 `overflow:hidden`，而卡片的绘制位置 = **layout 槽位 + translate**。

- `drag.originLeft` 在 `mousedown` 时记录一次，之后**从不更新**。
- 每次交换后，卡片的 layout 槽位移动了一整格（268.75px）。
- `translate` 仍按**旧的**原点计算，于是两者叠加，卡片每交换一次就偏离指针**一整格**：

```
交换 1 次：槽位 101 → 270，平移 289  → 绘制 384，指针 524  偏差 270px
交换 2 次：槽位 270 → 540，平移 269  → 绘制 925，指针 775  偏差 539px
交换 3 次：槽位 540 → 809，平移 809  → 绘制 1854，指针 1045 偏差 809px  ← 已在网格外
```

这解释了用户看到的现象：**顺序好像变对了，但卡片飞到屏幕外面去了**，或者"拖不动/乱跳"。

同时 `swapAdjacent` 里交换后重新 `measure()` 槽位矩形，是第二个缺陷的来源：槽位是**位置**（没动），只有卡片换了。重测后再拿指针比对新矩形，指针已经落在"刚离开"的槽里，于是交换回去——这就是 1 → 2 → 1 的震荡。两者叠加，才会出现 1 → 2 → 1 → 3 → 7 这种既退又跳的轨迹。

---

## 9. 落地建议

1. **`test/render.mjs` 里那 4 条 `sourceText.includes(...)` 必须删除**，或至少改名标明它只是冒烟检查。它们给了虚假的安全感，是六次返工的直接原因。
2. **把 `npm run test:drag` 设为发布闸门**，红则不发版。
3. **每个新交互都先写"用户看到的"断言**：绘制盒子、计算样式、绘制顺序。避免断言内联字符串。
4. **保留变异测试习惯**：新写的断言，先拿一个故意坏的实现跑一遍，确认它会红。不红的断言等于没写。

### 局限性（诚实说明）

- 只测 `mouse`。触屏/笔是另一条输入路径（`pointerdown`/`touchstart`），当前实现只监听 `mousedown`，**移动端大概率完全拖不动**——这需要单独一轮，本方案未覆盖。
- 键盘可达性（Tab + 方向键重排）完全没有实现，套件也就无从断言。
- 拖拽越界后自动滚动（拖到窗口边缘滚动）未测。
- 依赖本机 Chrome/Edge；CI 里需要预装或用 `TBI_CHROME` 指定。
