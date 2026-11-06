// Shikaku ("divide by squares"): partition an N×N grid into rectangles so
// that each rectangle contains exactly one number, equal to its area.
//
// Everything here is pure: the seeded generator, the rule checker, and the
// localStorage progress helpers. The board component (components/Shikaku.tsx)
// owns the touch/mouse interaction on top of this.

// ---- geometry -----------------------------------------------------------

/** An axis-aligned rectangle of cells, inclusive on both ends, normalised so
 *  r0 <= r1 and c0 <= c1. */
export interface Rect {
  r0: number;
  c0: number;
  r1: number;
  c1: number;
}

export interface Clue {
  r: number;
  c: number;
  n: number;
}

export interface ShikakuPuzzle {
  id: string;
  size: number;
  clues: Clue[];
  /** The partition the generator built — one valid answer; others may exist. */
  solution: Rect[];
}

export const normRect = (a: { r: number; c: number }, b: { r: number; c: number }): Rect => ({
  r0: Math.min(a.r, b.r),
  c0: Math.min(a.c, b.c),
  r1: Math.max(a.r, b.r),
  c1: Math.max(a.c, b.c),
});

export const rectArea = (x: Rect) => (x.r1 - x.r0 + 1) * (x.c1 - x.c0 + 1);

export const rectContains = (x: Rect, r: number, c: number) =>
  r >= x.r0 && r <= x.r1 && c >= x.c0 && c <= x.c1;

export const rectsOverlap = (a: Rect, b: Rect) =>
  a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;

export const sameRect = (a: Rect, b: Rect) =>
  a.r0 === b.r0 && a.c0 === b.c0 && a.r1 === b.r1 && a.c1 === b.c1;

// ---- seeded randomness --------------------------------------------------

/** FNV-1a string hash → 32-bit seed. */
function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for puzzle layouts. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- puzzle ids ---------------------------------------------------------
// "<size>x<size>-<seed>", e.g. "7x7-k3f9a2" or "7x7-d20261103" (the daily).
// The seed is any URL-safe token; the puzzle is a pure function of the id.

export const SHIKAKU_SIZES = [10, 15, 18] as const;
export type ShikakuSize = (typeof SHIKAKU_SIZES)[number];
export const DEFAULT_SIZE: ShikakuSize = 10;
/** The Sunday special — one big board on top of the usual three. */
export const MEGA_SIZE = 25;
export const isSunday = (d: Date) => d.getDay() === 0;

export function makeShikakuId(size: number, seed: string): string {
  return `${size}x${size}-${seed}`;
}

export function parseShikakuId(id: string): { size: number; seed: string } | null {
  const m = /^(\d{1,2})x(\d{1,2})-([A-Za-z0-9_-]{1,32})$/.exec(id);
  if (!m || m[1] !== m[2]) return null;
  const size = Number(m[1]);
  if (size < 3 || size > 30) return null;
  return { size, seed: m[3] };
}

export function randomSeed(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** Local-date daily seed, e.g. "d20261103" — one shared puzzle per day per size. */
export function dailySeed(d = new Date()): string {
  return `d${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export const isDailySeed = (seed: string) => /^d\d{8}$/.test(seed);

// ---- generator ----------------------------------------------------------

/** Largest rectangle the generator leaves unsplit, per grid size. Bigger
 *  pieces make a harder puzzle; these keep the mix lively without many
 *  trivially small boxes. Easy to tune. */
function maxArea(size: number): number {
  if (size <= 5) return 6;
  if (size <= 7) return 8;
  if (size <= 10) return 12;
  if (size <= 15) return 16;
  return 20;
}

/**
 * Random rectangle partition by recursive splitting: start with the whole
 * grid, keep splitting any piece bigger than maxArea along a random axis at
 * a random line, then do a few extra random splits for variety. Splits
 * never produce a 1-cell piece unless the piece being split is a 1-wide
 * strip (so "1" clues are rare but possible, as in the published puzzle).
 */
export function generateShikaku(id: string): ShikakuPuzzle | null {
  const parsed = parseShikakuId(id);
  if (!parsed) return null;
  const { size } = parsed;
  const rand = rng(hashSeed(id));
  const limit = maxArea(size);

  const pieces: Rect[] = [{ r0: 0, c0: 0, r1: size - 1, c1: size - 1 }];

  const split = (x: Rect, force: boolean): [Rect, Rect] | null => {
    const h = x.r1 - x.r0 + 1;
    const w = x.c1 - x.c0 + 1;
    // A cut at k leaves k cells on one side. A piece becomes a single cell
    // only when it's 1 wide and gets cut 1 from an end — skip those unless
    // forced (a 1×2 strip over the limit can't be cut any other way).
    const cuts = (len: number, other: number) => {
      const ok: number[] = [];
      for (let k = 1; k < len; k++) {
        if (!force && other === 1 && (k === 1 || k === len - 1)) continue;
        ok.push(k);
      }
      return ok;
    };
    const rows = cuts(h, w);
    const cols = cuts(w, h);
    if (rows.length === 0 && cols.length === 0) return null;
    // Prefer cutting the long axis so pieces stay chunky rather than stringy.
    const cutRows =
      rows.length > 0 && (cols.length === 0 || rand() < (h >= w ? 0.7 : 0.3));
    if (cutRows) {
      const k = rows[Math.floor(rand() * rows.length)];
      return [
        { r0: x.r0, c0: x.c0, r1: x.r0 + k - 1, c1: x.c1 },
        { r0: x.r0 + k, c0: x.c0, r1: x.r1, c1: x.c1 },
      ];
    }
    const k = cols[Math.floor(rand() * cols.length)];
    return [
      { r0: x.r0, c0: x.c0, r1: x.r1, c1: x.c0 + k - 1 },
      { r0: x.r0, c0: x.c0 + k, r1: x.r1, c1: x.c1 },
    ];
  };

  // Phase 1: split until every piece fits under the area limit.
  for (let guard = 0; guard < 10000; guard++) {
    const i = pieces.findIndex((p) => rectArea(p) > limit);
    if (i < 0) break;
    const parts = split(pieces[i], true);
    if (!parts) break;
    pieces.splice(i, 1, ...parts);
  }

  // Phase 2: a handful of extra splits on mid-sized pieces so the puzzle
  // isn't always "as big as allowed" everywhere.
  const extra = Math.round(size * 0.6);
  for (let n = 0; n < extra; n++) {
    const candidates = pieces.map((_, i) => i).filter((i) => rectArea(pieces[i]) >= 4);
    if (candidates.length === 0) break;
    const i = candidates[Math.floor(rand() * candidates.length)];
    const parts = split(pieces[i], false);
    if (parts && rectArea(parts[0]) >= 2 && rectArea(parts[1]) >= 2) pieces.splice(i, 1, ...parts);
  }

  // One clue per piece, in a random cell of it.
  const clues: Clue[] = pieces.map((p) => {
    const r = p.r0 + Math.floor(rand() * (p.r1 - p.r0 + 1));
    const c = p.c0 + Math.floor(rand() * (p.c1 - p.c0 + 1));
    return { r, c, n: rectArea(p) };
  });

  return { id, size, clues, solution: pieces };
}

// ---- rule checking ------------------------------------------------------

export interface RectStatus {
  rect: Rect;
  /** Clue numbers inside the rectangle. Exactly one, equal to the area, is valid. */
  clues: number[];
  overlaps: boolean;
  valid: boolean;
}

export interface BoardStatus {
  rects: RectStatus[];
  /** Cells covered by at least one rectangle. */
  covered: number;
  total: number;
  solved: boolean;
}

export function checkBoard(puzzle: ShikakuPuzzle, rects: Rect[]): BoardStatus {
  const { size, clues } = puzzle;
  const cover = new Uint8Array(size * size);
  for (const x of rects) {
    for (let r = x.r0; r <= x.r1; r++) for (let c = x.c0; c <= x.c1; c++) cover[r * size + c]++;
  }
  const statuses: RectStatus[] = rects.map((x) => {
    const inside = clues.filter((q) => rectContains(x, q.r, q.c)).map((q) => q.n);
    let overlaps = false;
    for (let r = x.r0; r <= x.r1 && !overlaps; r++)
      for (let c = x.c0; c <= x.c1; c++)
        if (cover[r * size + c] > 1) {
          overlaps = true;
          break;
        }
    const valid = !overlaps && inside.length === 1 && inside[0] === rectArea(x);
    return { rect: x, clues: inside, overlaps, valid };
  });
  let covered = 0;
  for (let i = 0; i < cover.length; i++) if (cover[i] > 0) covered++;
  const solved =
    statuses.length > 0 && statuses.every((s) => s.valid) && covered === size * size;
  return { rects: statuses, covered, total: size * size, solved };
}

/** Index of the rectangle containing (r, c), or -1. */
export function rectAt(rects: Rect[], r: number, c: number): number {
  return rects.findIndex((x) => rectContains(x, r, c));
}

/** Commit a drawn rectangle: it replaces anything it overlaps, so the board
 *  never holds overlapping boxes and redrawing over a mistake just works. */
export function placeRect(rects: Rect[], next: Rect): Rect[] {
  return [...rects.filter((x) => !rectsOverlap(x, next)), next];
}

// ---- progress (localStorage only for now — not in cloud sync) ----------

export interface ShikakuProgress {
  rects: Rect[];
  elapsed: number;
  solved: boolean;
  updatedAt: number;
}

const key = (id: string) => `shikaku:progress:${id}`;

export function loadShikakuProgress(id: string): ShikakuProgress | null {
  try {
    const raw = localStorage.getItem(key(id));
    return raw ? (JSON.parse(raw) as ShikakuProgress) : null;
  } catch {
    return null;
  }
}

export function saveShikakuProgress(id: string, p: ShikakuProgress): void {
  try {
    localStorage.setItem(key(id), JSON.stringify(p));
  } catch {
    /* storage full/unavailable — play continues in memory */
  }
}

export function clearShikakuProgress(id: string): void {
  try {
    localStorage.removeItem(key(id));
  } catch {
    /* ignore */
  }
}

/** Every Shikaku puzzle with saved progress, newest first — for the
 *  landing page's "continue" list. */
export function listShikakuProgress(): { id: string; progress: ShikakuProgress }[] {
  const out: { id: string; progress: ShikakuProgress }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("shikaku:progress:")) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      try {
        out.push({ id: k.slice("shikaku:progress:".length), progress: JSON.parse(raw) });
      } catch {
        /* skip malformed */
      }
    }
  } catch {
    /* unavailable */
  }
  return out.sort((a, b) => b.progress.updatedAt - a.progress.updatedAt);
}
