import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { goTo } from "../App.tsx";
import {
  checkBoard,
  clearShikakuProgress,
  generateShikaku,
  isDailySeed,
  loadShikakuProgress,
  makeShikakuId,
  normRect,
  parseShikakuId,
  placeRect,
  randomSeed,
  rectAt,
  rectArea,
  rectContains,
  rectsOverlap,
  saveShikakuProgress,
  type Rect,
  type ShikakuPuzzle,
} from "../lib/shikaku.ts";
import { loadSettings, saveSettings, type InputMode, type Settings } from "../lib/settings.ts";

const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Numbers get a colour each (styles.css defines --n1…--n12); bigger areas
 *  wrap around the palette. */
const colourIndex = (n: number) => ((n - 1) % 12) + 1;

const dailyLabel = (seed: string) => {
  const d = new Date(Number(seed.slice(1, 5)), Number(seed.slice(5, 7)) - 1, Number(seed.slice(7, 9)));
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Boards wider than this get a fixed cell size, zoom, scrolling and the minimap. */
const BIG = 12;
const CELL_DEFAULT = 32;
const CELL_MAX = 48;
/** Frame chrome around the cells: 6px padding + 3px border, each side. */
const FRAME_CHROME = 18;
/** Horizontal padding of the scroll viewport (.board-scroll.big), both sides. */
const SCROLL_PAD = 36;
const MINIMAP_SIZE = 72;
const MINIMAP_HIDE_MS = 600;
/** A touch that moves less than this (px) and ends within TAP_MS is a tap. */
const TAP_SLOP = 10;
const TAP_MS = 500;

export function Play({ id }: { id: string }) {
  const puzzle = useMemo(() => generateShikaku(id), [id]);
  if (!puzzle) {
    return (
      <div className="page">
        <TopBar title="Shikaku" />
        <p className="notice">That isn’t a puzzle link.</p>
        <button className="btn primary" onClick={() => goTo("")}>
          Today’s puzzles
        </button>
      </div>
    );
  }
  return <Board puzzle={puzzle} />;
}

function TopBar({ title, sub, right }: { title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <button className="back" onClick={() => goTo("")} aria-label="All puzzles">
        ◀
      </button>
      <h1 className="topbar-title">
        {title}
        {sub && <span className="topbar-sub">{sub}</span>}
      </h1>
      <div className="topbar-right">{right}</div>
    </header>
  );
}

interface Cell {
  r: number;
  c: number;
}
interface Pt {
  x: number;
  y: number;
}

function Board({ puzzle }: { puzzle: ShikakuPuzzle }) {
  const { size, id } = puzzle;
  const seed = parseShikakuId(id)?.seed ?? "";
  const daily = isDailySeed(seed);
  const big = size > BIG;

  const initial = useMemo(() => loadShikakuProgress(id), [id]);
  const [rects, setRects] = useState<Rect[]>(initial?.rects ?? []);
  const [history, setHistory] = useState<Rect[][]>([]);
  const [elapsed, setElapsed] = useState(initial?.elapsed ?? 0);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const setInput = (input: InputMode) => {
    const next = { ...settings, input };
    setSettings(next);
    saveSettings(next);
    setAnchor(null);
    setPreview(null);
  };
  const modeRef = useRef(settings.input);
  modeRef.current = settings.input;

  const status = useMemo(() => checkBoard(puzzle, rects), [puzzle, rects]);
  const solved = status.solved;

  useEffect(() => {
    document.title = `Shikaku ${size}×${size}`;
  }, [size]);

  // Timer. Time is measured from timestamps, not interval ticks (which
  // iOS throttles or freezes). Only visible time counts: the running stretch
  // is folded into `base` whenever the page hides, and a gap between ticks of
  // more than a few seconds — a freeze with no visibilitychange — is dropped.
  const baseRef = useRef(initial?.elapsed ?? 0); // seconds already banked
  const anchorTimeRef = useRef<number | null>(null); // Date.now() when this stretch began
  useEffect(() => {
    if (solved) return;
    const start = () => {
      if (anchorTimeRef.current === null) anchorTimeRef.current = Date.now();
    };
    const stop = () => {
      if (anchorTimeRef.current !== null) {
        baseRef.current += (Date.now() - anchorTimeRef.current) / 1000;
        anchorTimeRef.current = null;
      }
      setElapsed(baseRef.current);
    };
    const onVis = () => (document.visibilityState === "visible" ? start() : stop());
    let lastTick = Date.now();
    const tick = () => {
      const now = Date.now();
      const gap = now - lastTick;
      lastTick = now;
      if (anchorTimeRef.current === null) return;
      if (gap > 5000) anchorTimeRef.current += gap; // frozen, not playing
      setElapsed(baseRef.current + (now - anchorTimeRef.current) / 1000);
    };
    if (document.visibilityState === "visible") start();
    const t = setInterval(tick, 250);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", onVis);
      stop();
    };
  }, [solved]);

  // Persist on every change. An untouched board isn't saved, but once
  // anything has been, an emptied board is too.
  const everSaved = useRef(!!initial);
  useEffect(() => {
    if (rects.length === 0 && !everSaved.current) return;
    everSaved.current = true;
    saveShikakuProgress(id, { rects, elapsed, solved, updatedAt: Date.now() });
  }, [id, rects, elapsed, solved]);

  const commit = useCallback(
    (next: Rect[]) => {
      setHistory((h) => [...h.slice(-50), rects]);
      setRects(next);
    },
    [rects],
  );
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setRects(prev);
    setAnchor(null);
  };
  const reset = () => {
    commit([]);
    baseRef.current = 0;
    if (anchorTimeRef.current !== null) anchorTimeRef.current = Date.now();
    setElapsed(0);
    setDismissed(false);
    setAnchor(null);
    clearShikakuProgress(id);
  };
  const another = () => goTo(makeShikakuId(size, randomSeed()));

  // ---- geometry ------------------------------------------------------------
  const boardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rectsRef = useRef(rects);
  rectsRef.current = rects;
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const cellAt = useCallback(
    (x: number, y: number): Cell | null => {
      const el = boardRef.current;
      if (!el) return null;
      const b = el.getBoundingClientRect();
      const c = Math.floor(((x - b.left) / b.width) * size);
      const r = Math.floor(((y - b.top) / b.height) * size);
      return { r: clamp(r, 0, size - 1), c: clamp(c, 0, size - 1) };
    },
    [size],
  );

  // ---- zoom (big boards) ---------------------------------------------------
  // The cell size drives the frame width; everything inside is fractional, so
  // the grid and the overlays follow. Zooming out stops where the whole board
  // fits the viewport width.
  const [cell, setCell] = useState(CELL_DEFAULT);
  const cellRef = useRef(cell);
  cellRef.current = cell;
  const fitCell = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return 10;
    return Math.max(8, Math.floor((sc.clientWidth - SCROLL_PAD - FRAME_CHROME) / size));
  }, [size]);
  /** Set the cell size, keeping the content point under `anchor` (client
   *  coords) where it is. Applied to the DOM immediately so a pinch tracks
   *  the fingers; React catches up on the next render. */
  const applyCell = useCallback(
    (next: number, anchor?: Pt) => {
      const sc = scrollRef.current;
      const frame = frameRef.current;
      if (!sc || !frame || !big) return;
      const cur = cellRef.current;
      next = clamp(Math.round(next * 10) / 10, fitCell(), CELL_MAX);
      if (next === cur) return;
      const b = sc.getBoundingClientRect();
      const ax = anchor ? anchor.x - b.left : sc.clientWidth / 2;
      const ay = anchor ? anchor.y - b.top : sc.clientHeight / 2;
      const k = next / cur;
      const cx = sc.scrollLeft + ax;
      const cy = sc.scrollTop + ay;
      frame.style.width = `${size * next + FRAME_CHROME}px`;
      frame.style.setProperty("--cell", `${next}px`);
      sc.scrollLeft = cx * k - ax;
      sc.scrollTop = cy * k - ay;
      cellRef.current = next;
      setCell(next);
    },
    [big, fitCell, size],
  );
  const zoomBy = (f: number) => applyCell(cellRef.current * f);

  // ---- minimap -------------------------------------------------------------
  const minimapRef = useRef<HTMLDivElement>(null);
  const minimapViewRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef(0);
  const updateMinimap = useCallback(() => {
    const sc = scrollRef.current;
    const mv = minimapViewRef.current;
    const mm = minimapRef.current;
    if (!sc || !mv || !mm) return;
    const overflow = sc.scrollWidth > sc.clientWidth + 2 || sc.scrollHeight > sc.clientHeight + 2;
    mm.dataset.useful = overflow ? "1" : "0";
    const lx = clamp(sc.scrollLeft / sc.scrollWidth, 0, 1);
    const ly = clamp(sc.scrollTop / sc.scrollHeight, 0, 1);
    mv.style.left = `${lx * 100}%`;
    mv.style.top = `${ly * 100}%`;
    mv.style.width = `${clamp(sc.clientWidth / sc.scrollWidth, 0, 1 - lx) * 100}%`;
    mv.style.height = `${clamp(sc.clientHeight / sc.scrollHeight, 0, 1 - ly) * 100}%`;
  }, []);
  /** Fade the minimap in, and back out shortly after the last call. */
  const showMinimap = useCallback(() => {
    const mm = minimapRef.current;
    if (!mm) return;
    updateMinimap();
    if (mm.dataset.useful !== "1") return;
    mm.classList.add("show");
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => mm.classList.remove("show"), MINIMAP_HIDE_MS);
  }, [updateMinimap]);
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc || !big) return;
    updateMinimap();
    const onScroll = () => showMinimap();
    sc.addEventListener("scroll", onScroll, { passive: true });
    // Ctrl/⌘ + wheel zooms on desktop; a plain wheel scrolls natively.
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      applyCell(cellRef.current * (e.deltaY < 0 ? 1.1 : 0.9), { x: e.clientX, y: e.clientY });
      showMinimap();
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      sc.removeEventListener("scroll", onScroll);
      sc.removeEventListener("wheel", onWheel);
      window.clearTimeout(hideTimer.current);
    };
  }, [big, showMinimap, updateMinimap, applyCell]);

  // ---- drawing ---------------------------------------------------------------
  // Two ways to draw, chosen in settings:
  //  drag: one finger (or the mouse) drags corner to corner, previewing as it
  //        goes; two fingers pan and pinch-zoom. The board owns all touches.
  //  tap:  tap a corner, then the opposite corner. One finger pans natively
  //        (touch-action lets the browser scroll); two fingers pinch-zoom.
  // Either way a tap on an existing box removes it, and a tap on a bare "1"
  // boxes it in.
  const dragRef = useRef<{ anchor: Cell; cur: Cell; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  // A box goes down only when it would be correct — exactly one clue inside,
  // equal to its area — and it covers no cell already boxed. Wrong or
  // overlapping selections are simply not placed; removal is an explicit tap.
  const canPlace = useCallback(
    (x: Rect): boolean => {
      if (rectsRef.current.some((y) => rectsOverlap(x, y))) return false;
      const inside = puzzle.clues.filter((q) => rectContains(x, q.r, q.c));
      return inside.length === 1 && inside[0].n === rectArea(x);
    },
    [puzzle],
  );

  const removeOrOne = useCallback(
    (c: Cell): boolean => {
      const current = rectsRef.current;
      const i = rectAt(current, c.r, c.c);
      if (i >= 0) {
        commitRef.current(current.filter((_, j) => j !== i));
        return true;
      }
      if (puzzle.clues.some((q) => q.r === c.r && q.c === c.c && q.n === 1)) {
        commitRef.current(placeRect(current, normRect(c, c)));
        return true;
      }
      return false;
    },
    [puzzle],
  );

  // drag mode
  const begin = useCallback(
    (x: number, y: number) => {
      const c = cellAt(x, y);
      if (!c) return;
      dragRef.current = { anchor: c, cur: c, moved: false };
      setPreview(normRect(c, c));
    },
    [cellAt],
  );
  const move = useCallback(
    (x: number, y: number) => {
      const d = dragRef.current;
      if (!d) return;
      const c = cellAt(x, y);
      if (!c || (c.r === d.cur.r && c.c === d.cur.c)) return;
      d.cur = c;
      if (c.r !== d.anchor.r || c.c !== d.anchor.c) d.moved = true;
      setPreview(normRect(d.anchor, c));
    },
    [cellAt],
  );
  const end = useCallback(
    (cancel = false) => {
      const d = dragRef.current;
      dragRef.current = null;
      setPreview(null);
      if (!d || cancel) return;
      if (!d.moved) {
        removeOrOne(d.anchor);
        return;
      }
      const x = normRect(d.anchor, d.cur);
      if (canPlace(x)) commitRef.current(placeRect(rectsRef.current, x));
    },
    [removeOrOne, canPlace],
  );

  // tap mode
  const tap = useCallback(
    (c: Cell | null) => {
      if (!c) return;
      const a = anchorRef.current;
      if (a) {
        if (a.r === c.r && a.c === c.c) {
          // second tap on the anchor cancels
          setAnchor(null);
          setPreview(null);
          return;
        }
        const x = normRect(a, c);
        if (!canPlace(x)) return; // not a correct box yet: keep the anchor
        setAnchor(null);
        setPreview(null);
        commitRef.current(placeRect(rectsRef.current, x));
        return;
      }
      if (removeOrOne(c)) return;
      setAnchor(c);
    },
    [removeOrOne, canPlace],
  );

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    let pinch: { dist: number; mid: Pt; cell: number; sl: number; st: number } | null = null;
    let tapStart: { x: number; y: number; t: number } | null = null;
    let ignoreUntilLift = false;
    const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = (a: Touch, b: Touch): Pt => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        end(true);
        tapStart = null;
        const sc = scrollRef.current;
        const [a, b] = [e.touches[0], e.touches[1]];
        pinch = { dist: dist(a, b), mid: mid(a, b), cell: cellRef.current, sl: sc?.scrollLeft ?? 0, st: sc?.scrollTop ?? 0 };
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (e.touches.length !== 1 || ignoreUntilLift) return;
      const t = e.touches[0];
      if (modeRef.current === "tap") {
        tapStart = { x: t.clientX, y: t.clientY, t: Date.now() };
        return; // not prevented: the browser pans
      }
      e.preventDefault();
      begin(t.clientX, t.clientY);
    };
    const onMove = (e: TouchEvent) => {
      if (pinch && e.touches.length === 2) {
        if (e.cancelable) e.preventDefault();
        const sc = scrollRef.current;
        const [a, b] = [e.touches[0], e.touches[1]];
        const m = mid(a, b);
        if (big && sc) {
          // Zoom about the fingers and keep the originally grabbed content
          // point under their midpoint, which is a pan when they move together.
          const next = clamp(pinch.cell * (dist(a, b) / pinch.dist), fitCell(), CELL_MAX);
          const k = next / pinch.cell;
          const br = sc.getBoundingClientRect();
          if (next !== cellRef.current) applyCell(next, m);
          sc.scrollLeft = (pinch.sl + pinch.mid.x - br.left) * k - (m.x - br.left);
          sc.scrollTop = (pinch.st + pinch.mid.y - br.top) * k - (m.y - br.top);
          showMinimap();
        }
        return;
      }
      if (modeRef.current === "tap") return;
      if (!dragRef.current) return;
      e.preventDefault();
      move(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onEnd = (e: TouchEvent) => {
      if (pinch) {
        if (e.touches.length < 2) {
          pinch = null;
          ignoreUntilLift = e.touches.length > 0;
        }
        return;
      }
      if (e.touches.length === 0) ignoreUntilLift = false;
      if (modeRef.current === "tap") {
        const s = tapStart;
        tapStart = null;
        if (!s) return;
        const t = e.changedTouches[0];
        if (Math.hypot(t.clientX - s.x, t.clientY - s.y) < TAP_SLOP && Date.now() - s.t < TAP_MS) {
          if (e.cancelable) e.preventDefault(); // no synthetic click
          tap(cellAt(t.clientX, t.clientY));
        }
        return;
      }
      if (!dragRef.current) return;
      e.preventDefault();
      end();
    };
    const onCancel = () => {
      pinch = null;
      tapStart = null;
      ignoreUntilLift = false;
      end(true);
    };
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onCancel);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [begin, move, end, tap, cellAt, big, fitCell, applyCell, showMinimap]);

  // Mouse: drag mode drags; tap mode clicks, with a hover preview from the anchor.
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || settings.input === "tap") return;
    e.preventDefault();
    begin(e.clientX, e.clientY);
    const onMM = (ev: MouseEvent) => move(ev.clientX, ev.clientY);
    const onMU = () => {
      window.removeEventListener("mousemove", onMM);
      window.removeEventListener("mouseup", onMU);
      end();
    };
    window.addEventListener("mousemove", onMM);
    window.addEventListener("mouseup", onMU);
  };
  const onClick = (e: React.MouseEvent) => {
    if (settings.input !== "tap") return;
    tap(cellAt(e.clientX, e.clientY));
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (settings.input !== "tap" || !anchor) return;
    const c = cellAt(e.clientX, e.clientY);
    if (c) setPreview(normRect(anchor, c));
  };

  // ---- render ------------------------------------------------------------
  // Place overlays on exact cell edges: the board has --pad around and --gap
  // between cells, so a cell's pitch is (side - 2·pad + gap) / size and a
  // box spanning k cells is k·pitch minus one trailing gap.
  const pitch = `((100% - 2 * var(--pad) + var(--gap)) / ${size})`;
  const rectStyle = (x: Rect) => ({
    left: `calc(var(--pad) + ${x.c0} * ${pitch})`,
    top: `calc(var(--pad) + ${x.r0} * ${pitch})`,
    width: `calc(${x.c1 - x.c0 + 1} * ${pitch} - var(--gap))`,
    height: `calc(${x.r1 - x.r0 + 1} * ${pitch} - var(--gap))`,
  });
  const clueByCell = useMemo(() => {
    const m = new Map<number, number>();
    for (const q of puzzle.clues) m.set(q.r * size + q.c, q.n);
    return m;
  }, [puzzle, size]);
  const previewArea = preview ? (preview.r1 - preview.r0 + 1) * (preview.c1 - preview.c0 + 1) : 0;
  // Green as soon as the box being drawn would be a correct one.
  const previewGood = useMemo(() => (preview ? canPlace(preview) : false), [preview, canPlace, rects]);
  const wrongCount = status.rects.filter((s) => !s.valid).length;
  const atFit = big && cell <= fitCell();

  return (
    <div className="page play">
      <TopBar
        title={`${size}×${size}`}
        sub={daily ? dailyLabel(seed) : "practice"}
        right={
          <>
            <span className={`clock${solved ? " stopped" : ""}`}>{fmtTime(elapsed)}</span>
            <button className="iconbtn" onClick={() => setShowSettings(true)} aria-label="Settings">
              ⚙
            </button>
            <button className="iconbtn" onClick={() => setShowHelp(true)} aria-label="How to play">
              ?
            </button>
          </>
        }
      />

      <div className="board-viewport">
        <div ref={scrollRef} className={`board-scroll${big ? " big" : ""}`}>
          <div
            ref={frameRef}
            className={`board-frame${solved ? " solved" : ""}`}
            style={big ? { width: size * cell + FRAME_CHROME, ["--cell" as string]: `${cell}px` } : undefined}
          >
            <div
              ref={boardRef}
              className={`board${settings.input === "tap" ? " tapmode" : ""}`}
              style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
              data-size={size}
              onMouseDown={onMouseDown}
              onClick={onClick}
              onMouseMove={onMouseMove}
              onMouseLeave={() => settings.input === "tap" && setPreview(null)}
              onContextMenu={(e) => e.preventDefault()}
              role="application"
              aria-label={`Shikaku board, ${size} by ${size}`}
            >
              {Array.from({ length: size * size }, (_, i) => {
                const n = clueByCell.get(i);
                return (
                  <div key={i} className="cell" data-n={n === undefined ? undefined : colourIndex(n)}>
                    {n ?? ""}
                  </div>
                );
              })}
              {status.rects.map((s, i) => (
                <div
                  key={i}
                  className={`rect ${s.valid ? "ok" : "bad"}`}
                  data-n={s.valid ? colourIndex(s.clues[0]) : undefined}
                  style={rectStyle(s.rect)}
                />
              ))}
              {anchor && <div className="rect anchor" style={rectStyle(normRect(anchor, anchor))} />}
              {preview && (
                <div className={`rect preview${previewGood ? " good" : ""}`} style={rectStyle(preview)}>
                  <span className="preview-area">{previewArea}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        {big && (
          <div ref={minimapRef} className="minimap" style={{ width: MINIMAP_SIZE, height: MINIMAP_SIZE }} aria-hidden>
            <svg viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="none">
              {status.rects.map((s, i) => (
                <rect
                  key={i}
                  x={s.rect.c0}
                  y={s.rect.r0}
                  width={s.rect.c1 - s.rect.c0 + 1}
                  height={s.rect.r1 - s.rect.r0 + 1}
                  fill={s.valid ? `var(--n${colourIndex(s.clues[0])})` : "var(--bad)"}
                  opacity={0.85}
                />
              ))}
              {puzzle.clues.map((q, i) => (
                <rect key={`c${i}`} x={q.c + 0.3} y={q.r + 0.3} width={0.4} height={0.4} fill={`var(--n${colourIndex(q.n)})`} />
              ))}
            </svg>
            <div ref={minimapViewRef} className="minimap-view" />
          </div>
        )}
      </div>

      <p className="status">
        {solved
          ? "Solved."
          : anchor
            ? "Now tap the opposite corner"
            : wrongCount > 0
              ? `${wrongCount} box${wrongCount === 1 ? "" : "es"} to fix`
              : `${status.covered} of ${status.total} cells`}
      </p>

      <div className="actions">
        {big && (
          <>
            <button className="btn zoom" onClick={() => zoomBy(1 / 1.25)} disabled={atFit} aria-label="Zoom out">
              −
            </button>
            <button className="btn zoom" onClick={() => zoomBy(1.25)} disabled={cell >= CELL_MAX} aria-label="Zoom in">
              +
            </button>
          </>
        )}
        <button className="btn" onClick={undo} disabled={history.length === 0}>
          Undo
        </button>
        <button className="btn" onClick={reset} disabled={rects.length === 0}>
          Clear
        </button>
        <button className="btn" onClick={another}>
          Random {size}×{size}
        </button>
      </div>

      {solved && !dismissed && (
        <Sheet onClose={() => setDismissed(true)}>
          <h2 className="sheet-title">Solved</h2>
          <p className="sheet-time">{fmtTime(elapsed)}</p>
          <p className="sheet-sub">
            {size}×{size}
            {daily ? ` · ${dailyLabel(seed)}` : ""} · {rects.length} rectangles
          </p>
          <div className="actions">
            <button className="btn primary" onClick={() => goTo("")}>
              More puzzles
            </button>
            <button className="btn" onClick={another}>
              Random {size}×{size}
            </button>
          </div>
        </Sheet>
      )}

      {showSettings && (
        <Sheet onClose={() => setShowSettings(false)}>
          <h2 className="sheet-title">Settings</h2>
          <div className="setting">
            <p className="setting-label">Drawing boxes</p>
            <button className={`opt${settings.input === "drag" ? " on" : ""}`} onClick={() => setInput("drag")}>
              <b>Drag</b>
              <span>One finger drags corner to corner. Two fingers pan and pinch-zoom.</span>
            </button>
            <button className={`opt${settings.input === "tap" ? " on" : ""}`} onClick={() => setInput("tap")}>
              <b>Tap corners</b>
              <span>Tap one corner, then the opposite corner. One finger pans; pinch zooms.</span>
            </button>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => setShowSettings(false)}>
              Done
            </button>
          </div>
        </Sheet>
      )}

      {showHelp && (
        <Sheet onClose={() => setShowHelp(false)}>
          <h2 className="sheet-title">How to play</h2>
          <div className="help">
            <p>
              Split the whole grid into rectangles. Every rectangle contains
              exactly one number, and that number is its area.
            </p>
            <ul>
              {settings.input === "drag" ? (
                <li>
                  <b>Drag</b> from one corner to the opposite corner to draw a
                  box. It turns <b>green</b> when it’s right, and only a green
                  box is placed.
                </li>
              ) : (
                <li>
                  <b>Tap</b> one corner, then the opposite corner, to draw a
                  box. The first corner stays put until you tap a corner that
                  makes a correct box, or tap it again to cancel.
                </li>
              )}
              <li>
                <b>Tap</b> a box to remove it. Boxes never overwrite each other.
              </li>
              <li>Tap a lone <b>1</b> to box it in.</li>
              <li>
                On the big Sunday board,{" "}
                {settings.input === "drag" ? <b>two fingers</b> : <b>one finger</b>} pan
                around, <b>pinch</b> zooms, and a little map shows where you are.
                Switch how you draw in <b>Settings</b> (the gear).
              </li>
            </ul>
            <p className="dim">
              The daily puzzles are the same for everyone. Progress stays on
              this device.
            </p>
          </div>
          <div className="actions">
            <button className="btn primary" onClick={() => setShowHelp(false)}>
              Got it
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Bottom sheet on phones, centred card on wider screens. */
function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
