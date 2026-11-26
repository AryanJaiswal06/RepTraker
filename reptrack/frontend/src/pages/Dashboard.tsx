import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Plus, Save, Search, Timer, TrendingUp, X } from "lucide-react";
import { api } from "../api";
import ExerciseForm from "../components/ExerciseForm";
import ProgressChart from "../components/ProgressChart";
import SetEditor from "../components/SetEditor";
import WorkoutHeatmap from "../components/WorkoutHeatmap";
import { fmtDate, toDisplay, useSettings } from "../settings";
import { AnalyticsResponse, DashboardExercise, Exercise, Group, SetRow } from "../types";

const draftsKey = (userId: number) => `reptrack:drafts:${userId}`;
const readDrafts = (key: string): Record<number, SetRow[]> => { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } };
const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();
const validDone = (r: SetRow) => r.done && (r.weight > 0 || r.reps > 0);

function playRestChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch {
    // Ignore audio restrictions when autoplay is blocked
  }
}

export default function Dashboard({ userId, active: isTabActive, resetKey }: { userId: number; active: boolean; resetKey: number }) {
  const storageKey = draftsKey(userId);
  const { s } = useSettings();
  const [items, setItems] = useState<DashboardExercise[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [workoutDates, setWorkoutDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, SetRow[]>>(() => readDrafts(storageKey));
  const dirtyRef = useRef<Set<number>>(new Set(Object.keys(readDrafts(storageKey)).map(Number)));
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyGroupAdd, setBusyGroupAdd] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [rest, setRest] = useState(0);
  const [restDoneBanner, setRestDoneBanner] = useState(false);
  const msgTimer = useRef<number | undefined>();

  const flash = useCallback((text: string, err = false) => {
    window.clearTimeout(msgTimer.current);
    setStatus({ text, err });
    msgTimer.current = window.setTimeout(() => setStatus(null), 2500);
  }, []);

  // Next-session suggestion: the last saved sets, editable and unticked.
  const fresh = useCallback((e: DashboardExercise): SetRow[] =>
    e.last_session ? e.last_session.sets.map((r) => ({ ...r, done: false }))
      : Array.from({ length: s.defaultSets }, () => ({ weight: 0, reps: 0, done: false })), [s.defaultSets]);

  // `reset` lists exercises that were just saved (or "all"); unmodified exercises refresh from server.
  const load = useCallback(async (reset: number[] | "all" = []) => {
    const [data, gs, analytics] = await Promise.all([
      api.get<DashboardExercise[]>("/api/dashboard"),
      api.get<Group[]>("/api/groups"),
      api.get<AnalyticsResponse>("/api/analytics"),
    ]);
    setItems(data);
    setGroups(gs);
    setWorkoutDates(analytics.workout_dates);
    if (reset === "all") {
      dirtyRef.current = new Set();
      setDrafts(Object.fromEntries(data.map((e) => [e.id, fresh(e)])));
      return;
    }
    for (const id of reset) dirtyRef.current.delete(id);
    setDrafts((prev) =>
      Object.fromEntries(
        data.map((e) => [e.id, dirtyRef.current.has(e.id) && prev[e.id] ? prev[e.id] : fresh(e)])
      )
    );
  }, [fresh]);

  useEffect(() => {
    if (isTabActive) {
      load().catch((e) => flash(e.message, true)).finally(() => setLoading(false));
    }
  }, [isTabActive, load, flash]);

  useEffect(() => {
    if (resetKey === 0) return;
    setOpen(new Set());
    setGroupId(null);
    setQ("");
    setAdding(false);
    setRest(0);
    setRestDoneBanner(false);
    load("all").catch((e) => flash(e.message, true));
  }, [resetKey, load, flash]);

  useEffect(() => { // keep unsaved, ticked work across refreshes
    const keep = Object.fromEntries(Object.entries(drafts).filter(([, v]) => v.some((r) => r.done)));
    localStorage.setItem(storageKey, JSON.stringify(keep));
  }, [drafts, storageKey]);

  useEffect(() => {
    if (rest <= 0) return;
    const t = setTimeout(() => {
      if (rest === 1) {
        playRestChime();
        setRestDoneBanner(true);
      }
      setRest((r) => r - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [rest]);

  useEffect(() => {
    if (!restDoneBanner) return;
    const t = setTimeout(() => setRestDoneBanner(false), 4000);
    return () => clearTimeout(t);
  }, [restDoneBanner]);

  useEffect(() => {
    if (!adding) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAdding(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding]);

  useEffect(() => () => window.clearTimeout(msgTimer.current), []);

  const group = groups.find((g) => g.id === groupId);
  const defaultGroupIds = useMemo(() => (group ? [group.id] : []), [group?.id]);
  const notInGroup = useMemo(() => (group ? items.filter((e) => !e.group_ids.includes(group.id)) : []), [items, group]);
  const inGroup = useMemo(() => (groupId ? items.filter((e) => e.group_ids.includes(groupId)) : items), [items, groupId]);
  const shown = inGroup.filter((e) => [e.name, e.muscle_group, e.equipment].some((t) => t.toLowerCase().includes(q.toLowerCase())));
  const allSetsInGroup = inGroup.flatMap((e) => drafts[e.id] || []);
  const doneSets = inGroup.flatMap((e) => (drafts[e.id] || []).filter(validDone));
  const activeCount = inGroup.filter((e) => (drafts[e.id] || []).some(validDone)).length;
  const completedTodayCount = inGroup.filter((e) => isToday(e.stats.last_date) || (drafts[e.id] || []).some(validDone)).length;
  const pct = inGroup.length ? Math.round((completedTodayCount / inGroup.length) * 100) : 0;
  const volume = doneSets.reduce((a, r) => a + r.weight * r.reps, 0);
  const toggle = (id: number) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const updateDraft = (id: number, v: SetRow[]) => {
    dirtyRef.current.add(id);
    setDrafts((prev) => ({ ...prev, [id]: v }));
  };

  async function addExistingToGroup(ex: DashboardExercise) {
    if (!group || busyGroupAdd) return;
    setBusyGroupAdd(true);
    try {
      await api.put(`/api/groups/${group.id}`, { exercise_ids: [...group.exercise_ids, ex.id] });
      await load();
      setOpen((o) => new Set(o).add(ex.id));
      flash(`Added ${ex.name} to ${group.name}`);
    } catch (e) {
      flash((e as Error).message, true);
    } finally {
      setBusyGroupAdd(false);
    }
  }

  async function saveEntries(list: DashboardExercise[], doneMsg: string) {
    const entries = list.filter((e) => (drafts[e.id] || []).some(validDone))
      .map((e) => ({ exercise_id: e.id, sets: drafts[e.id] }));
    if (!entries.length) {
      flash("Enter weight or reps for at least one ticked set", true);
      return;
    }
    setSaving(true);
    try {
      const res = await api.post<{ saved: number[] }>("/api/workouts", { entries });
      await load(res.saved);
      if (res.saved.length) {
        setRest(0);
        setRestDoneBanner(false);
        flash(doneMsg);
      } else {
        flash("Nothing was saved — check that ticked sets have weight or reps", true);
      }
    } catch (e) {
      flash((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  const chip = (on: boolean) =>
    `shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
      on ? "bg-accent text-white shadow-sm" : "border border-line bg-card text-muted hover:text-fg"
    }`;

  return (
    <div className="space-y-5">
      {/* Top Header + Progress (Strive Studio) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{group ? `${group.name} Routine` : "Workout Dashboard"}</h1>
            <p className="text-xs text-muted">
              {inGroup.length ? `${completedTodayCount} of ${inGroup.length} exercises active or done today · ${pct}%` : "Add exercises or select a routine to begin"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              <Plus size={15} /> {group ? `Add to ${group.name}` : "Add exercise"}
            </button>
            <button type="button" className="btn-primary" disabled={!doneSets.length || saving}
              onClick={() => saveEntries(inGroup, group ? `${group.name} completed` : "Workout saved")}>
              <Save size={15} /> {group ? `Complete ${group.name}` : "Complete workout"}
            </button>
          </div>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-raised">
          <div className="h-full rounded-full bg-gradient-to-r from-accent to-mint transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Bento KPI Row (Kinetic Pro) */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-line bg-card p-3.5 shadow-sm">
          <div className="text-xs text-muted">Active Exercises</div>
          <div className="num mt-1 text-lg font-semibold">
            {activeCount} <span className="text-xs font-normal text-muted">/ {inGroup.length}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-card p-3.5 shadow-sm">
          <div className="text-xs text-muted">Sets Ticked</div>
          <div className="num mt-1 text-lg font-semibold text-mint">
            {doneSets.length} <span className="text-xs font-normal text-muted">/ {allSetsInGroup.length}</span>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-card p-3.5 shadow-sm">
          <div className="text-xs text-muted">Live Volume</div>
          <div className="num mt-1 text-lg font-semibold">
            {Math.round(toDisplay(volume, s.unit)).toLocaleString()} <span className="text-xs font-normal text-muted">{s.unit}</span>
          </div>
        </div>
      </div>

      {/* Consistency Heatmap & Streak */}
      {!loading && <WorkoutHeatmap dates={workoutDates} />}

      {/* Search, Filter Pills & Collapse */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-9" placeholder="Search exercises by name, muscle or equipment" aria-label="Search exercises" value={q}
              onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" className="btn" onClick={() => setOpen(open.size ? new Set() : new Set(shown.map((e) => e.id)))}
            aria-label={open.size ? "Collapse all" : "Expand all"}>
            {open.size ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
          </button>
        </div>

        {groups.length > 0 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
            <button type="button" className={chip(groupId === null)} onClick={() => setGroupId(null)}>All ({items.length})</button>
            {groups.map((g) => (
              <button type="button" key={g.id} className={chip(groupId === g.id)} onClick={() => setGroupId(g.id)}>
                {g.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {status && <p role="status" className={`text-sm font-medium ${status.err ? "text-red-400" : "text-mint"}`}>{status.text}</p>}

      {adding && (
        <section className="space-y-4 rounded-2xl border border-accent/40 bg-card p-5 shadow-md">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{group ? `Add exercise to ${group.name}` : "New exercise"}</h2>
            <button type="button" className="text-muted hover:text-fg" aria-label="Close add exercise" onClick={() => setAdding(false)}>
              <X size={16} />
            </button>
          </div>
          {group && (
            <div className="space-y-2">
              <p className="text-xs text-muted">Pick an existing exercise</p>
              {notInGroup.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {notInGroup.map((ex) => (
                    <button type="button" key={ex.id} disabled={busyGroupAdd} onClick={() => addExistingToGroup(ex)}
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-raised px-3 py-1 text-xs font-medium text-fg hover:border-accent hover:text-accent disabled:opacity-40">
                      <Plus size={13} /> {ex.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">All active exercises are already in {group.name}.</p>
              )}
              <div className="border-t border-line pt-3">
                <p className="mb-2 text-xs text-muted">Or create a new exercise</p>
              </div>
            </div>
          )}
          <ExerciseForm
            groups={groups}
            defaultGroupIds={defaultGroupIds}
            submitLabel={group ? `Create & add to ${group.name}` : "Add exercise"}
            onCancel={() => setAdding(false)}
            onSubmit={async (d) => {
              try {
                const created = await api.post<Exercise>("/api/exercises", d);
                await load();
                setOpen((o) => new Set(o).add(created.id));
                setAdding(false);
                flash(group && d.group_ids.includes(group.id) ? `Added ${created.name} to ${group.name}` : `${created.name} added`);
              } catch (e) {
                flash((e as Error).message, true);
                throw e;
              }
            }}
          />
        </section>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Loading workouts…</p>
      ) : !shown.length && (
        <p className="py-10 text-center text-sm text-muted">
          {items.length ? "No exercises match." : "No exercises yet. Add one above or in the Exercises tab."}
        </p>
      )}

      {shown.map((e) => {
        const isOpen = open.has(e.id);
        const prev = e.last_session?.sets ?? [];
        const draft = drafts[e.id] || [];
        const canSaveExercise = draft.some(validDone);
        const doneToday = isToday(e.stats.last_date);
        const bestTickedDisplay = canSaveExercise
          ? Math.max(...draft.filter(validDone).map((r) => toDisplay(r.weight, s.unit)))
          : 0;
        const lastDisplay = e.stats.last_weight != null ? toDisplay(e.stats.last_weight, s.unit) : null;
        const delta = lastDisplay != null && bestTickedDisplay > lastDisplay
          ? Math.round((bestTickedDisplay - lastDisplay) * 10) / 10
          : 0;
        const stripe = canSaveExercise || doneToday ? "border-l-mint" : isOpen ? "border-l-accent" : "border-l-line";

        return (
          <section key={e.id} className={`rounded-2xl border border-line border-l-4 ${stripe} bg-card shadow-sm transition-colors`}>
            <button type="button" className="flex w-full items-start gap-3 p-4 text-left" onClick={() => toggle(e.id)} aria-expanded={isOpen}>
              <span className="mt-1 text-muted">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{e.name}</span>
                  <span className="chip">{e.muscle_group}</span>
                  <span className="chip">{e.equipment}</span>
                  {doneToday && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-mint/15 px-2 py-0.5 text-xs font-medium text-mint">
                      <Check size={12} /> Done today
                    </span>
                  )}
                  {delta > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-mint/15 px-2 py-0.5 text-xs font-medium text-mint">
                      <TrendingUp size={12} /> +{delta} {s.unit} vs last
                    </span>
                  )}
                </span>
                <span className="mt-2 block text-xs text-muted">Last workout: {fmtDate(e.stats.last_date)}</span>
                <span className="num mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {prev.length ? prev.map((r, i) => (
                    <span key={i}><span className="text-muted">{i + 1}</span> {toDisplay(r.weight, s.unit)}{s.unit} × {r.reps}</span>
                  )) : <span className="text-muted">No previous sets</span>}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="space-y-4 border-t border-line p-4">
                {e.notes && <p className="rounded-xl bg-raised px-3 py-2 text-xs text-muted">{e.notes}</p>}
                <SetEditor sets={draft} prev={prev} prWeight={e.stats.max_weight}
                  onChange={(v) => updateDraft(e.id, v)}
                  onSetDone={() => {
                    if (s.restSeconds > 0) {
                      setRestDoneBanner(false);
                      setRest(s.restSeconds);
                    }
                  }} />
                <div className="flex gap-2">
                  <button type="button" className="btn" onClick={() => updateDraft(e.id, draft.map((r) => ({ ...r, done: true })))}>
                    <CheckCheck size={15} /> Tick all
                  </button>
                  <button type="button" className="btn-primary flex-1" disabled={saving || !canSaveExercise}
                    onClick={() => saveEntries([e], `${e.name} saved`)}>
                    <Check size={15} /> Complete exercise
                  </button>
                </div>
                <dl className="num grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs sm:grid-cols-5">
                  {[
                    ["Last weight", e.stats.last_weight != null ? `${toDisplay(e.stats.last_weight, s.unit)} ${s.unit}` : "–"],
                    ["Last reps", e.stats.last_reps ?? "–"],
                    ["Best weight", e.stats.max_weight != null ? `${toDisplay(e.stats.max_weight, s.unit)} ${s.unit}` : "–"],
                    ["Sessions", e.stats.total_sessions],
                    ["Last workout", fmtDate(e.stats.last_date)],
                  ].map(([k, v]) => (<div key={k as string}><dt className="text-muted">{k}</dt><dd className="mt-0.5 text-sm font-medium">{v}</dd></div>))}
                </dl>
                <ProgressChart points={e.history} />
              </div>
            )}
          </section>
        );
      })}

      {(rest > 0 || restDoneBanner) && (
        <div className="fixed inset-x-0 bottom-16 z-20 flex justify-center px-4 md:bottom-6">
          <div className="flex items-center gap-3 rounded-full border border-line bg-card px-4 py-2 shadow-xl">
            <Timer size={15} className="text-mint" />
            {rest > 0 ? (
              <>
                <span className="num text-sm font-medium">Rest {Math.floor(rest / 60)}:{String(rest % 60).padStart(2, "0")}</span>
                <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setRest((r) => r + 30)}>+30s</button>
                <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setRest(0)}>Skip</button>
              </>
            ) : (
              <>
                <span className="text-sm font-medium text-mint">Rest complete</span>
                <button type="button" className="text-xs text-muted hover:text-fg" onClick={() => setRestDoneBanner(false)}>Dismiss</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
