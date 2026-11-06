import { useMemo } from "react";
import { goTo } from "../App.tsx";
import {
  MEGA_SIZE,
  SHIKAKU_SIZES,
  type ShikakuSize,
  dailySeed,
  isSunday,
  listShikakuProgress,
  makeShikakuId,
  randomSeed,
  type ShikakuProgress,
} from "../lib/shikaku.ts";

const DAYS_BACK = 6;

const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const dayLabel = (d: Date, i: number) =>
  i === 0
    ? "Today"
    : i === 1
      ? "Yesterday"
      : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

export function Home() {
  const saved = useMemo(() => {
    const m = new Map<string, ShikakuProgress>();
    for (const s of listShikakuProgress()) m.set(s.id, s.progress);
    return m;
  }, []);

  const days = useMemo(() => {
    const out: { date: Date; seed: string; label: string; sizes: readonly number[] }[] = [];
    for (let i = 0; i <= DAYS_BACK; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({
        date: d,
        seed: dailySeed(d),
        label: dayLabel(d, i),
        // Sundays get the mega board as a fourth card.
        sizes: isSunday(d) ? [...SHIKAKU_SIZES, MEGA_SIZE] : SHIKAKU_SIZES,
      });
    }
    return out;
  }, []);

  return (
    <div className="page home">
      <header className="masthead">
        <h1 className="wordmark">Shikaku</h1>
        <p className="tagline">
          Divide the grid into rectangles. Each one holds a single number — its
          area. A new set every day, the same for everyone.
        </p>
      </header>

      {days.map((d, i) => (
        <section className={`day${i === 0 ? " today" : ""}`} key={d.seed}>
          <h2 className="day-head">{d.label}</h2>
          <div className="size-row">
            {d.sizes.map((n) => {
              const id = makeShikakuId(n, d.seed);
              const p = saved.get(id);
              const state = p?.solved ? "done" : p && p.rects.length > 0 ? "going" : "";
              return (
                <button
                  key={n}
                  className={`size-card ${state}${n === MEGA_SIZE ? " mega" : ""}`}
                  onClick={() => goTo(id)}
                >
                  <span className="size-card-n">
                    {n === MEGA_SIZE ? "Mega " : ""}
                    {n}×{n}
                  </span>
                  <span className="size-card-sub">
                    {p?.solved
                      ? `Solved · ${fmtTime(p.elapsed)}`
                      : p && p.rects.length > 0
                        ? "In progress"
                        : n === MEGA_SIZE
                          ? "Sunday special"
                          : (["Easy", "Medium", "Hard"][SHIKAKU_SIZES.indexOf(n as ShikakuSize)] ?? "")}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <section className="day practice">
        <h2 className="day-head">Practice</h2>
        <div className="size-row">
          {[...SHIKAKU_SIZES, MEGA_SIZE].map((n) => (
            <button
              key={n}
              className={`size-card${n === MEGA_SIZE ? " mega" : ""}`}
              onClick={() => goTo(makeShikakuId(n, randomSeed()))}
            >
              <span className="size-card-n">
                {n === MEGA_SIZE ? "Mega " : ""}
                {n}×{n}
              </span>
              <span className="size-card-sub">Random</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
