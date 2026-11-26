import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { api } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import ProgressChart from "../components/ProgressChart";
import SetEditor from "../components/SetEditor";
import { fmtDate, toDisplay, useSettings } from "../settings";
import { Exercise, ProgressPoint, Session, SetRow } from "../types";

export default function History() {
  const { s } = useSettings();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [filter, setFilter] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draft, setDraft] = useState<SetRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const msgTimer = useRef<number | undefined>();

  const flash = useCallback((text: string, err = false) => {
    window.clearTimeout(msgTimer.current);
    setStatus({ text, err });
    msgTimer.current = window.setTimeout(() => setStatus(null), 2500);
  }, []);

  const load = useCallback(async () => {
    try {
      setSessions(await api.get<Session[]>(`/api/sessions${filter ? `?exercise_id=${filter}` : ""}`));
    } catch (e) {
      flash((e as Error).message, true);
    } finally {
      setLoading(false);
    }
  }, [filter, flash]);

  useEffect(() => {
    api.get<Exercise[]>("/api/exercises?archived=1").then(setExercises).catch((e) => flash(e.message, true));
  }, [flash]);

  useEffect(() => { load(); setOpenId(null); }, [load]);
  useEffect(() => () => window.clearTimeout(msgTimer.current), []);

  const chartPoints = useMemo<ProgressPoint[]>(() => {
    if (!filter) return [];
    return [...sessions].reverse().map((ss) => {
      const done = ss.sets.filter((r) => r.done);
      const sets = done.length ? done : ss.sets;
      const best_weight = sets.length ? Math.max(...sets.map((r) => r.weight)) : 0;
      const volume = sets.reduce((a, r) => a + r.weight * r.reps, 0);
      const est_1rm = sets.reduce((m, r) => (r.weight > 0 ? Math.max(m, r.weight * (1 + r.reps / 30)) : m), 0);
      return { date: ss.performed_at, best_weight, volume, est_1rm };
    });
  }, [filter, sessions]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Workout History</h1>
        <p className="text-xs text-muted">RepTrack keeps the latest 15 sessions for each exercise.</p>
      </div>
      <div>
        <select className="input" aria-label="Filter by exercise" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All exercises</option>
          {exercises.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>
      {filter && !loading && <ProgressChart points={chartPoints} />}
      {status && <p role="status" className={`text-sm font-medium ${status.err ? "text-red-400" : "text-mint"}`}>{status.text}</p>}
      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Loading history…</p>
      ) : !sessions.length && (
        <p className="py-10 text-center text-sm text-muted">No workouts recorded yet. Save one from the Dashboard.</p>
      )}

      {sessions.map((ss) => {
        const isOpen = openId === ss.id;
        const validSets = draft.filter((r) => r.weight > 0 || r.reps > 0);
        const totalVol = ss.sets.reduce((acc, r) => acc + r.weight * r.reps, 0);
        return (
          <section key={ss.id} className="rounded-2xl border border-line bg-card">
            <button type="button" className="flex w-full items-start gap-3 p-4 text-left" aria-expanded={isOpen}
              onClick={() => { setOpenId(isOpen ? null : ss.id); setDraft(ss.sets); }}>
              <span className="mt-1 text-muted">{isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
              <span className="flex-1">
                <span className="flex justify-between gap-2">
                  <span className="font-medium">{ss.exercise_name}</span>
                  <span className="num text-xs text-muted">
                    {fmtDate(ss.performed_at)}{totalVol > 0 ? ` · ${Math.round(toDisplay(totalVol, s.unit)).toLocaleString()} ${s.unit}` : ""}
                  </span>
                </span>
                <span className="num mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {ss.sets.map((r, i) => <span key={i}>{toDisplay(r.weight, s.unit)}{s.unit} × {r.reps}</span>)}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="space-y-3 border-t border-line p-4">
                <SetEditor sets={draft} onChange={setDraft} />
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" disabled={busy || !validSets.length} onClick={async () => {
                    setBusy(true);
                    try {
                      await api.put(`/api/sessions/${ss.id}`, { sets: validSets.map((r) => ({ ...r, done: true })) });
                      flash("Session updated");
                      await load();
                    } catch (e) {
                      flash((e as Error).message, true);
                    } finally {
                      setBusy(false);
                    }
                  }}>Save changes</button>
                  <button type="button" className="btn" onClick={() => setOpenId(null)}>Cancel</button>
                  <button type="button" className="btn" disabled={busy} onClick={() => setConfirmDeleteId(ss.id)}>
                    <Trash2 size={14} /> Delete session
                  </button>
                </div>
              </div>
            )}
          </section>
        );
      })}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete session?"
        message="Delete this workout session? This can't be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={async () => {
          const id = confirmDeleteId;
          setConfirmDeleteId(null);
          if (id === null) return;
          setBusy(true);
          try {
            await api.del(`/api/sessions/${id}`);
            setOpenId(null);
            flash("Session deleted");
            await load();
          } catch (e) {
            flash((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
