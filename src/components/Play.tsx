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
  saveShikakuProgress,
  type Rect,
  type ShikakuPuzzle,
} from "../lib/shikaku.ts";

const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Numbers get a colour each (styles.css defines --n1…--n12); bigger areas
 *  wrap around the palette. */
const colourIndex = (n: number) => ((n - 1) % 12) + 1;

const dailyLabel = (seed: string) => {
  const d = new Date(Number(seed.slice(1, 5)), Number(seed.slice(5, 7)) - 1, Number(seed.slice(7, 9)));
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

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

function Board({ puzzle }: { puzzle: ShikakuPuzzle }) {
  const { size, id } = puzzle;
  const seed = parseShikakuId(id)?.seed ?? "";
  const daily = isDailySeed(seed);

  const initial = useMemo(() => loadShikakuProgress(id), [id]);
  const [rects, setRects] = useState<Rect[]>(initial?.rects ?? []);
  const [history, setHistory] = useState<Rect[][]>([]);
  const [elapsed, setElapsed] = useState(initial?.elapsed ?? 0);
  const [showHelp, setShowHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const status = useMemo(() => checkBoard(puzzle, rects), [puzzle, rects]);
  const solved = status.solved;

  useEffect(() => {
    document.title = `Shikaku ${size}×${size}`;
  }, [size]);

  // Timer: ticks while unsolved and the tab is visible.
  useEffect(() => {
    if (solved) return;
    let last = Date.now();
    const t = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === "visible") setElapsed((e) => e + (now - last) / 1000);
      last = now;
    }, 1000);
    return () => clearInterval(t);
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
  };
  const reset = () => {
    commit([]);
    setElapsed(0);
    setDismissed(false);
    clearShikakuProgress(id);
  };
  const another = () => goTo(makeShikakuId(size, randomSeed()));

  // ---- drag-to-draw ------------------------------------------------------
  // Raw touch events on a touch-action:none board (pointer events misbehave
  // on iPhone Safari), mirrored by a mouse path for desktop.
  const boardRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const dragRef = useRef<{ anchor: Cell; cur: Cell; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
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
      return { r: Math.max(0, Math.min(size - 1, r)), c: Math.max(0, Math.min(size - 1, c)) };
    },
    [size],
  );
  const begin = useCallback(
    (x: number, y: number) => {
      const cell = cellAt(x, y);
      if (!cell) return;
      dragRef.current = { anchor: cell, cur: cell, moved: false };
      setPreview(normRect(cell, cell));
    },
    [cellAt],
  );
  const move = useCallback(
    (x: number, y: number) => {
      const d = dragRef.current;
      if (!d) return;
      const cell = cellAt(x, y);
      if (!cell || (cell.r === d.cur.r && cell.c === d.cur.c)) return;
      d.cur = cell;
      if (cell.r !== d.anchor.r || cell.c !== d.anchor.c) d.moved = true;
      setPreview(normRect(d.anchor, cell));
    },
    [cellAt],
  );
  const end = useCallback(
    (cancel = false) => {
      const d = dragRef.current;
      dragRef.current = null;
      setPreview(null);
      if (!d || cancel) return;
      const current = rectsRef.current;
      if (!d.moved) {
        // A tap: lift an existing box, or drop a 1×1 on a "1".
        const i = rectAt(current, d.anchor.r, d.anchor.c);
        if (i >= 0) commitRef.current(current.filter((_, j) => j !== i));
        else if (puzzle.clues.some((q) => q.r === d.anchor.r && q.c === d.anchor.c && q.n === 1))
          commitRef.current(placeRect(current, normRect(d.anchor, d.anchor)));
        return;
      }
      commitRef.current(placeRect(current, normRect(d.anchor, d.cur)));
    },
    [puzzle],
  );

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    // One finger draws; two fingers pan the scroll frame (big boards are
    // wider than the screen, and touch-action:none turns native panning off).
    const onStart = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 2) {
        end(true);
        const sc = scrollRef.current;
        const [a, b] = [e.touches[0], e.touches[1]];
        panRef.current = {
          x: (a.clientX + b.clientX) / 2,
          y: (a.clientY + b.clientY) / 2,
          sl: sc?.scrollLeft ?? 0,
          st: sc?.scrollTop ?? 0,
        };
        return;
      }
      if (e.touches.length !== 1) return end(true);
      begin(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      if (panRef.current && e.touches.length === 2) {
        const sc = scrollRef.current;
        if (!sc) return;
        const [a, b] = [e.touches[0], e.touches[1]];
        sc.scrollLeft = panRef.current.sl - ((a.clientX + b.clientX) / 2 - panRef.current.x);
        sc.scrollTop = panRef.current.st - ((a.clientY + b.clientY) / 2 - panRef.current.y);
        return;
      }
      if (!dragRef.current) return;
      move(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (panRef.current) {
        if (e.touches.length === 0) panRef.current = null;
        return;
      }
      if (!dragRef.current) return;
      end();
    };
    const onCancel = () => {
      panRef.current = null;
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
  }, [begin, move, end]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
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

  // ---- render ------------------------------------------------------------
  const pct = (n: number) => `${(n / size) * 100}%`;
  const rectStyle = (x: Rect) => ({
    left: pct(x.c0),
    top: pct(x.r0),
    width: pct(x.c1 - x.c0 + 1),
    height: pct(x.r1 - x.r0 + 1),
  });
  const clueByCell = useMemo(() => {
    const m = new Map<number, number>();
    for (const q of puzzle.clues) m.set(q.r * size + q.c, q.n);
    return m;
  }, [puzzle, size]);
  const previewArea = preview ? (preview.r1 - preview.r0 + 1) * (preview.c1 - preview.c0 + 1) : 0;
  const wrongCount = status.rects.filter((s) => !s.valid).length;

  return (
    <div className="page play">
      <TopBar
        title={`${size}×${size}`}
        sub={daily ? dailyLabel(seed) : "practice"}
        right={
          <>
            <span className={`clock${solved ? " stopped" : ""}`}>{fmtTime(elapsed)}</span>
            <button className="iconbtn" onClick={() => setShowHelp(true)} aria-label="How to play">
              ?
            </button>
          </>
        }
      />

      <div ref={scrollRef} className={`board-scroll${size > 12 ? " big" : ""}`}>
      <div className={`board-frame${solved ? " solved" : ""}`}>
        <div
          ref={boardRef}
          className="board"
          style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
          data-size={size}
          onMouseDown={onMouseDown}
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
          {preview && (
            <div className="rect preview" style={rectStyle(preview)}>
              <span className="preview-area">{previewArea}</span>
            </div>
          )}
        </div>
      </div>
      </div>

      <p className="status">
        {solved
          ? "Solved."
          : wrongCount > 0
            ? `${wrongCount} box${wrongCount === 1 ? "" : "es"} to fix`
            : `${status.covered} of ${status.total} cells`}
      </p>

      <div className="actions">
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

      {showHelp && (
        <Sheet onClose={() => setShowHelp(false)}>
          <h2 className="sheet-title">How to play</h2>
          <div className="help">
            <p>
              Split the whole grid into rectangles. Every rectangle contains
              exactly one number, and that number is its area.
            </p>
            <ul>
              <li>
                <b>Drag</b> from one corner to the opposite corner to draw a
                box. The little number is its area so far.
              </li>
              <li>
                <b>Tap</b> a box to remove it. Drawing over boxes replaces them.
              </li>
              <li>Tap a lone <b>1</b> to box it in.</li>
              <li>
                On the big Sunday board, <b>two fingers</b> pan around; one
                finger still draws.
              </li>
              <li>
                A box takes its number’s colour when it’s right, and turns
                <b> red</b> when it isn’t.
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
