/**
 * Driving a real pointer, and reading back what the reader would see.
 *
 * Every gesture here goes through Chrome's own input pipeline — `page.mouse.down`,
 * `page.mouse.move`, `page.mouse.up` — so the page receives real, trusted
 * `mousedown`/`mousemove`/`mouseup` events at real coordinates. Nothing in this
 * file calls a React handler or dispatches a synthetic DOM event: that is what
 * `test/render.mjs` does, and it is exactly the blind spot this suite exists to
 * close.
 *
 * Sampling is *test-driven*, not timer-driven. After each waypoint the test
 * asks the page to paint and then reads the geometry, so a row in the trace
 * always means "after the browser finished reacting to this pointer position".
 * An rAF loop runs alongside it, but only to catch motion that happens while
 * the pointer is still — the oscillation case, where a wrong implementation
 * swaps back and forth forever.
 */

const RECORDER = () => {
  const tiles = () => [...document.querySelectorAll('.tbi-figureTile')];
  const labelOf = (tile) => tile?.querySelector('.tbi-figureLabel')?.textContent ?? '';
  const centerOf = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

  const recorder = {
    still: [],
    stillActive: false,
    pointer: null,
    frames: 0,
    scrollTop0: 0,
  };

  /** One observation of everything the acceptance checks look at. */
  const sample = (source) => {
    const all = tiles();
    const dragging = all.filter((tile) => tile.dataset.dragging === 'true');
    const lifted = dragging[0] ?? null;
    const rect = lifted === null ? null : lifted.getBoundingClientRect();
    const grid = document.querySelector('.tbi-figures');
    const gridRect = grid === null ? null : grid.getBoundingClientRect();
    return {
      source,
      frame: recorder.frames,
      at: performance.now(),
      pointer: recorder.pointer,
      order: all.map(labelOf),
      /** Which slot the lifted tile occupies in the painted order. */
      index: lifted === null ? -1 : all.indexOf(lifted),
      sorting: grid?.dataset.sorting ?? null,
      /** Scroll offset, so a page that scrolls mid-drag is visible as such. */
      scrollTop: document.querySelector('.tbi-scroll')?.scrollTop ?? 0,
      grid: gridRect === null ? null : {
        left: gridRect.left, top: gridRect.top, width: gridRect.width, height: gridRect.height,
      },
      lifted: lifted === null ? null : {
        label: labelOf(lifted),
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        center: centerOf(rect),
        transform: getComputedStyle(lifted).transform,
        zIndex: getComputedStyle(lifted).zIndex,
        cursor: getComputedStyle(lifted).cursor,
        transitionProperty: getComputedStyle(lifted).transitionProperty,
        transitionDuration: getComputedStyle(lifted).transitionDuration,
        boxShadow: getComputedStyle(lifted).boxShadow,
        opacity: getComputedStyle(lifted).opacity,
      },
      /** Every tile's painted box, so a swap can be checked for real movement. */
      tiles: all.map((tile) => {
        const box = tile.getBoundingClientRect();
        return {
          label: labelOf(tile),
          left: box.left, top: box.top, width: box.width, height: box.height,
          center: centerOf(box),
          dragging: tile.dataset.dragging === 'true',
          /** The computed transform: `none` once the tile has settled. */
          transform: getComputedStyle(tile).transform,
          /** The inline transform the component set, or ''. */
          inlineTransform: tile.style.transform,
        };
      }),
    };
  };

  window.addEventListener('mousemove', (event) => {
    recorder.pointer = { x: event.clientX, y: event.clientY };
  }, true);

  // An idle loop: it records nothing until a test arms it, and then it records
  // every frame, which is what catches a board that keeps moving by itself.
  const loop = () => {
    recorder.frames += 1;
    if (recorder.stillActive) recorder.still.push(sample('still'));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  window.__TBI_DRAG__ = {
    /** Begin a gesture: reset the traces and note the pre-drag position. */
    start({ pointer }) {
      recorder.pointer = pointer ?? recorder.pointer;
      recorder.pointerTrace = [];
      recorder.still = [];
      recorder.stillActive = false;
      recorder.scrollTop0 = document.querySelector('.tbi-scroll')?.scrollTop ?? 0;
      return sample('start');
    },
    /** Record one row after the browser has settled on this pointer position. */
    snap(source = 'pointer') {
      const row = sample(source);
      recorder.pointerTrace.push(row);
      return row;
    },
    pointerTrace() {
      return recorder.pointerTrace ?? [];
    },
    /** Watch for motion while nothing is happening. */
    watch(active) {
      recorder.stillActive = active === true;
      if (active !== true) return recorder.still.length;
      recorder.still = [];
      return 0;
    },
    stillTrace() {
      return recorder.still;
    },
    /** The board without a gesture: the baseline every check compares to. */
    rest() {
      return sample('rest');
    },
    layoutWrites() {
      return window.__TBI__.layoutWrites.map((write) => write.order);
    },
    layoutReads() {
      return window.__TBI__.layoutReads.length;
    },
    /** Console output the page produced, minus the plugin's own breadcrumbs. */
    consoleErrors() {
      return window.__TBI__.consoleErrors.filter((line) => !line.startsWith('[token-bi] '));
    },
    /** Force layout and wait for two paints: "the browser has caught up". */
    settle() {
      return new Promise((resolve) => {
        // Read a layout property to flush pending style, then wait for the paint
        // that follows it. Two frames covers a React commit scheduled from a
        // continuous event, which may land one frame after the move.
        const probe = document.querySelector('.tbi-figures');
        if (probe !== null) probe.getBoundingClientRect();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    },
    /**
     * Wait until nothing on the board is moving any more.
     *
     * A drop runs the tile's CSS transition back to scale(1), so the painted
     * boxes keep changing for ~180ms after `mouseup`. Comparing "before" and
     * "after" positions mid-transition measures the animation, not the
     * rearrangement — so every resting read goes through here first.
     *
     * Returns how long it took, which is itself an acceptance fact: a board that
     * never stops moving fails the budget instead of hanging the suite.
     */
    async settleStable({ maxMs = 1200, quietFrames = 3 } = {}) {
      const fingerprint = () => [...document.querySelectorAll('.tbi-figureTile')]
        .map((tile) => {
          const rect = tile.getBoundingClientRect();
          return `${rect.left.toFixed(1)},${rect.top.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)}`;
        })
        .join('|');
      const started = performance.now();
      let previous = fingerprint();
      let quiet = 0;
      while (performance.now() - started < maxMs) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const current = fingerprint();
        if (current === previous) {
          quiet += 1;
          if (quiet >= quietFrames) return { stable: true, ms: performance.now() - started };
        } else {
          quiet = 0;
          previous = current;
        }
      }
      return { stable: false, ms: performance.now() - started };
    },
  };
};

/** Install the in-page recorder (idempotent). */
export async function installRecorder(page) {
  const installed = await page.evaluate(() => window.__TBI_DRAG__ !== undefined);
  if (installed) return;
  await page.evaluate(RECORDER);
}

/** The painted box of one card, by its label text. */
export async function cardBox(page, label) {
  const box = await page.evaluate((target) => {
    const tile = [...document.querySelectorAll('.tbi-figureTile')]
      .find((candidate) => (candidate.querySelector('.tbi-figureLabel')?.textContent ?? '') === target);
    if (tile === undefined) return null;
    // Only scroll when the tile is actually out of view. Scrolling a tile that
    // is already visible moves every other tile, which turns "did the drag move
    // anything" into a comparison against a shifted baseline.
    const before = tile.getBoundingClientRect();
    const visible = before.top >= 0 && before.left >= 0
      && before.bottom <= window.innerHeight && before.right <= window.innerWidth;
    if (!visible) {
      tile.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    const rect = tile.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, label);
  if (box === null) {
    const present = await page.evaluate(() => [...document.querySelectorAll('.tbi-figureTile')]
      .map((tile) => tile.querySelector('.tbi-figureLabel')?.textContent ?? ''));
    throw new Error(`no card titled "${label}"; the board shows ${JSON.stringify(present)}`);
  }
  return box;
}

/** The resting state of the board, plus what was persisted. */
export async function readBoard(page) {
  await installRecorder(page);
  return page.evaluate(async () => {
    window.__TBI_DRAG__.settle();
    const stability = await window.__TBI_DRAG__.settleStable();
    return {
      stability,
      rest: window.__TBI_DRAG__.rest(),
      writes: window.__TBI_DRAG__.layoutWrites(),
      reads: window.__TBI_DRAG__.layoutReads(),
      errors: window.__TBI_DRAG__.consoleErrors(),
    };
  });
}

/**
 * Drive a pointer through a list of waypoints, sampling after each one.
 *
 * `steps` splits every leg into that many `mousemove`s. It is not cosmetic: a
 * single move from A to C is one event, so an implementation that only reacts
 * to the final position cannot be told apart from one that swaps per crossing.
 * A hand produces dozens of moves; so does this.
 *
 * `hold` makes the test pause *between* legs (and ask what moved without the
 * pointer), which is how the "still moving while the mouse is still" failure is
 * caught.
 */
export async function dragThrough(page, { label, waypoints, steps = 8, holdMs = 0, snapshotEachStep = true, chunk = 0 }) {
  await installRecorder(page);
  const start = await cardBox(page, label);
  const trace = [];

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // `start` is synchronous in-page; read the settled state rather than relying
  // on the returned sample, which predates React's commit for the press.
  await page.evaluate((pointer) => window.__TBI_DRAG__.start({ pointer }), { x: start.x, y: start.y });
  await page.evaluate(() => window.__TBI_DRAG__.settle());
  trace.push(await page.evaluate(() => window.__TBI_DRAG__.snap('pressed')));

  const legTraces = [];
  for (const [legIndex, point] of waypoints.entries()) {
    if (chunk > 0) {
      /*
       * Walk the leg in chunks and sample after each one.
       *
       * `page.mouse.move(..., {steps: n})` interpolates inside Chrome and hands
       * the test only the end state, which hides an implementation that swaps
       * out and back within the leg. Chunking makes every intermediate slot
       * visible, and is what turns "the order oscillates" from a suspicion into
       * a timestamped series.
       */
      const from = trace.at(-1).pointer ?? { x: start.x, y: start.y };
      const legs = Math.max(1, Math.round(steps / chunk));
      for (let index = 1; index <= legs; index += 1) {
        const ratio = index / legs;
        const x = from.x + (point.x - from.x) * ratio;
        const y = from.y + (point.y - from.y) * ratio;
        await page.mouse.move(x, y, { steps: chunk });
        await page.evaluate(() => window.__TBI_DRAG__.settle());
        if (snapshotEachStep) {
          trace.push(await page.evaluate((name) => window.__TBI_DRAG__.snap(name), `leg:${legIndex}.${index}`));
        }
      }
    } else {
      await page.mouse.move(point.x, point.y, { steps });
      await page.evaluate(() => window.__TBI_DRAG__.settle());
      if (snapshotEachStep) {
        trace.push(await page.evaluate((index) => window.__TBI_DRAG__.snap(`leg:${index}`), legIndex));
      }
    }
    if (holdMs > 0) {
      // Watch the board while the pointer is not moving. Any change here is the
      // implementation moving the cards on its own.
      await page.evaluate(() => window.__TBI_DRAG__.watch(true));
      await page.waitForTimeout(holdMs);
      const still = await page.evaluate(() => {
        window.__TBI_DRAG__.watch(false);
        return window.__TBI_DRAG__.stillTrace();
      });
      legTraces.push({ legIndex, still });
    }
  }

  const beforeRelease = await page.evaluate(() => window.__TBI_DRAG__.rest());
  return { start, trace, legTraces, beforeRelease };
}

/**
 * Release the pointer and read the board back.
 *
 * Returns the resting order, each tile's painted box, what the page persisted,
 * and any change observed in the frames right after the release — the last is
 * what distinguishes "settled into place" from "snapped somewhere afterwards".
 */
export async function releasePointer(page, { settleMs = 120 } = {}) {
  await page.evaluate(() => window.__TBI_DRAG__.watch(true));
  await page.mouse.up();
  await page.evaluate(() => window.__TBI_DRAG__.settle());
  // Wait for the drop's own transition to finish before calling the board
  // "resting": a scale transition is still running for ~180ms after mouseup.
  const stability = await page.evaluate(() => window.__TBI_DRAG__.settleStable());
  await page.waitForTimeout(settleMs);
  const after = await page.evaluate(() => {
    window.__TBI_DRAG__.watch(false);
    return {
      still: window.__TBI_DRAG__.stillTrace(),
      rest: window.__TBI_DRAG__.rest(),
      writes: window.__TBI_DRAG__.layoutWrites(),
      errors: window.__TBI_DRAG__.consoleErrors(),
    };
  });
  return { ...after, stability };
}

/**
 * One complete gesture, the way the panel's own docs describe it.
 *
 * Kept as a single call because most scenarios are "press on this card, walk
 * the pointer over these cards, let go" — and a scenario should read like that.
 */
export async function dragCard(page, { from, waypoints, steps = 8, holdMs = 0, settleMs = 120 }) {
  const press = await dragThrough(page, { label: from, waypoints, steps, holdMs });
  const release = await releasePointer(page, { settleMs });
  return { ...press, release, writes: release.writes, rest: release.rest };
}

/**
 * Press and release without moving the pointer.
 *
 * The control case. A drop without a move must not reorder anything — if this
 * fails, the board is reordering on press, and every "drag works" result above
 * it is meaningless.
 */
export async function pressOnly(page, { label, holdMs = 120 }) {
  await installRecorder(page);
  const start = await cardBox(page, label);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.evaluate(() => window.__TBI_DRAG__.start({ pointer: { x: 0, y: 0 } }));
  await page.evaluate(() => window.__TBI_DRAG__.settle());
  const pressed = await page.evaluate(() => window.__TBI_DRAG__.snap('pressed'));
  await page.waitForTimeout(holdMs);
  const held = await page.evaluate(() => window.__TBI_DRAG__.rest());
  await page.mouse.up();
  await page.evaluate(() => window.__TBI_DRAG__.settle());
  const after = await page.evaluate(() => ({
    rest: window.__TBI_DRAG__.rest(),
    writes: window.__TBI_DRAG__.layoutWrites(),
  }));
  return { start, pressed, held, ...after };
}
