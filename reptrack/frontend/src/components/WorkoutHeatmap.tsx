import { useMemo, useState } from "react";
import { Flame } from "lucide-react";

function localKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfWeekMonday(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (copy.getDay() + 6) % 7; // Monday = 0, Sunday = 6
  copy.setDate(copy.getDate() - diff);
  return copy;
}

const WEEKS = 12;

export default function WorkoutHeatmap({ dates }: { dates: string[] }) {
  const [hovered, setHovered] = useState<{ label: string; count: number } | null>(null);

  const data = useMemo(() => {
    const countsByDay = new Map<string, number>();
    for (const iso of dates) {
      const k = localKey(new Date(iso));
      countsByDay.set(k, (countsByDay.get(k) || 0) + 1);
    }

    const today = new Date();
    const todayKey = localKey(today);
    const currentWeekStart = startOfWeekMonday(today);
    const firstWeekStart = new Date(currentWeekStart);
    firstWeekStart.setDate(firstWeekStart.getDate() - (WEEKS - 1) * 7);

    const weeks: {
      weekLabel: string;
      monthLabel: string;
      activeDays: number;
      totalLogged: number;
      days: { key: string; label: string; count: number; isToday: boolean; isFuture: boolean }[];
    }[] = [];

    let lastMonth = "";
    for (let w = 0; w < WEEKS; w++) {
      const wStart = new Date(firstWeekStart);
      wStart.setDate(wStart.getDate() + w * 7);
      const weekLabel = wStart.toLocaleDateString(undefined, { day: "numeric", month: "short" });
      const monthName = wStart.toLocaleDateString(undefined, { month: "short" });
      const monthLabel = monthName !== lastMonth ? monthName : "";
      lastMonth = monthName;

      let activeDays = 0;
      let totalLogged = 0;
      const days = [];
      for (let d = 0; d < 7; d++) {
        const cur = new Date(wStart);
        cur.setDate(cur.getDate() + d);
        const key = localKey(cur);
        const count = countsByDay.get(key) || 0;
        const isFuture = cur > today && key !== todayKey;
        if (count > 0) {
          activeDays++;
          totalLogged += count;
        }
        days.push({
          key,
          label: cur.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
          count,
          isToday: key === todayKey,
          isFuture,
        });
      }
      weeks.push({ weekLabel, monthLabel, activeDays, totalLogged, days });
    }

    // Consecutive-day streak (ending today, or yesterday if today has no workouts yet)
    let dayStreak = 0;
    const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (!countsByDay.has(localKey(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (countsByDay.has(localKey(cursor))) {
      dayStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    // Consecutive-week streak (weeks with >= 1 workout, allowing current week to still be in progress)
    let weekStreak = 0;
    const weekCursor = new Date(currentWeekStart);
    const hasWorkoutInWeek = (ws: Date) => {
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws);
        d.setDate(d.getDate() + i);
        if (countsByDay.has(localKey(d))) return true;
      }
      return false;
    };
    if (!hasWorkoutInWeek(weekCursor)) {
      weekCursor.setDate(weekCursor.getDate() - 7);
    }
    while (hasWorkoutInWeek(weekCursor) && weekStreak < 104) {
      weekStreak++;
      weekCursor.setDate(weekCursor.getDate() - 7);
    }

    const thisWeek = weeks[weeks.length - 1];
    const totalActiveDays12w = weeks.reduce((a, w) => a + w.activeDays, 0);

    return { weeks, dayStreak, weekStreak, thisWeek, totalActiveDays12w };
  }, [dates]);

  const cellStyle = (count: number, isFuture: boolean, isToday: boolean) => {
    const ring = isToday ? "ring-2 ring-accent ring-offset-1 ring-offset-card" : "";
    if (isFuture) return `bg-raised/35 opacity-40 ${ring}`;
    if (count === 0) return `bg-raised ${ring}`;
    if (count === 1) return `bg-mint/35 ${ring}`;
    if (count <= 3) return `bg-mint/65 ${ring}`;
    return `bg-mint ${ring}`;
  };

  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-mint/15 text-mint">
            <Flame size={15} />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Consistency &amp; Streak</h2>
            <p className="text-xs text-muted">
              {hovered
                ? `${hovered.label}: ${hovered.count} ${hovered.count === 1 ? "exercise" : "exercises"} logged`
                : `Last 12 weeks · ${data.totalActiveDays12w} workout ${data.totalActiveDays12w === 1 ? "day" : "days"}`}
            </p>
          </div>
        </div>

        <div className="num flex items-center gap-2 text-xs">
          <div className="rounded-xl border border-line bg-raised/60 px-2.5 py-1">
            <span className="text-muted">Streak </span>
            <span className="font-semibold text-mint">{data.weekStreak}w</span>
            {data.dayStreak > 1 && <span className="text-muted"> ({data.dayStreak}d)</span>}
          </div>
          <div className="rounded-xl border border-line bg-raised/60 px-2.5 py-1">
            <span className="text-muted">This week </span>
            <span className="font-semibold">{data.thisWeek.activeDays}d</span>
            <span className="text-muted"> · {data.thisWeek.totalLogged} ex</span>
          </div>
        </div>
      </div>

      {/* 12-week calendar heatmap */}
      <div className="overflow-x-auto pb-1">
        <div className="inline-grid min-w-full grid-cols-[2.75rem_1fr] gap-x-2 gap-y-1">
          {/* Month headers */}
          <span />
          <div className="grid grid-cols-12 gap-1.5 text-[10px] font-medium text-muted">
            {data.weeks.map((w, wi) => (
              <span key={wi} className="truncate">{w.monthLabel}</span>
            ))}
          </div>

          {/* Day labels aligned 1:1 with the 7 rows */}
          <div className="grid grid-rows-7 gap-1.5 text-[10px] text-muted">
            {["Mon", "", "Wed", "", "Fri", "", "Sun"].map((lbl, i) => (
              <span key={i} className="flex h-3.5 items-center">{lbl}</span>
            ))}
          </div>

          {/* 12 week columns × 7 day tiles */}
          <div className="grid grid-cols-12 gap-1.5">
            {data.weeks.map((w, wi) => (
              <div key={wi} className="grid grid-rows-7 gap-1.5">
                {w.days.map((d) => (
                  <button
                    type="button"
                    key={d.key}
                    onMouseEnter={() => setHovered({ label: d.label, count: d.count })}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered({ label: d.label, count: d.count })}
                    onBlur={() => setHovered(null)}
                    title={`${d.label}: ${d.count} ${d.count === 1 ? "exercise" : "exercises"}`}
                    aria-label={`${d.label}: ${d.count} exercises logged`}
                    className={`h-3.5 w-full rounded-[4px] transition-transform hover:scale-110 ${cellStyle(d.count, d.isFuture, d.isToday)}`}
                  />
                ))}
              </div>
            ))}
          </div>

          {/* Workouts per week row */}
          <span className="flex items-center text-[10px] text-muted">Days/wk</span>
          <div className="grid grid-cols-12 gap-1.5">
            {data.weeks.map((w, wi) => (
              <span
                key={wi}
                className={`num text-center text-[10px] ${w.activeDays > 0 ? "font-medium text-mint" : "text-muted/70"}`}
                title={`Week of ${w.weekLabel}: ${w.activeDays} workout days`}
              >
                {w.activeDays}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-muted">
        <span>Outlined tile = Today</span>
        <div className="flex items-center gap-1.5">
          <span>Rest</span>
          <span className="h-2.5 w-2.5 rounded-[3px] bg-raised" />
          <span className="h-2.5 w-2.5 rounded-[3px] bg-mint/35" />
          <span className="h-2.5 w-2.5 rounded-[3px] bg-mint/65" />
          <span className="h-2.5 w-2.5 rounded-[3px] bg-mint" />
          <span>Active</span>
        </div>
      </div>
    </section>
  );
}
