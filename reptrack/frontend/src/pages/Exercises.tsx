import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import ExerciseForm from "../components/ExerciseForm";
import { Exercise, Group } from "../types";

export default function Exercises() {
  const [items, setItems] = useState<Exercise[]>([]);
  const [groupsList, setGroupsList] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Exercise | null>(null);
  const [err, setErr] = useState("");
  const seq = useRef(0);

  const load = useCallback(async () => {
    const id = ++seq.current;
    try {
      const [data, gs] = await Promise.all([
        api.get<Exercise[]>(`/api/exercises?q=${encodeURIComponent(q)}${showArchived ? "&archived=1" : ""}`),
        api.get<Group[]>("/api/groups"),
      ]);
      if (id === seq.current) {
        setItems(data);
        setGroupsList(gs);
        setErr("");
      }
    } catch (e) {
      if (id === seq.current) setErr((e as Error).message);
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, [q, showArchived]);

  useEffect(() => { load(); }, [load]);

  const groups = items.reduce<Record<string, Exercise[]>>((a, e) => ((a[e.muscle_group] ||= []).push(e), a), {});
  const groupName = (gid: number) => groupsList.find((g) => g.id === gid)?.name;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Exercises</h1>
        <p className="text-xs text-muted">Manage your exercise library, cues, muscle groups, and routines.</p>
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input pl-9" placeholder="Search by name, muscle or equipment" aria-label="Search exercises"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" onClick={() => setAdding(!adding)}><Plus size={15} /> New</button>
      </div>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      {adding && (
        <div className="rounded-2xl border border-line bg-card p-4">
          <ExerciseForm groups={groupsList} submitLabel="Add exercise" onCancel={() => setAdding(false)}
            onSubmit={async (d) => {
              setErr("");
              try { await api.post("/api/exercises", d); await load(); }
              catch (e) { setErr((e as Error).message); throw e; }
            }} />
        </div>
      )}
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
      </label>

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Loading exercises…</p>
      ) : !items.length && (
        <p className="py-10 text-center text-sm text-muted">No exercises found.</p>
      )}
      {Object.entries(groups).map(([g, list]) => (
        <section key={g} className="space-y-2">
          <h2 className="text-sm font-medium text-muted">{g}</h2>
          {list.map((e) => (
            <div key={e.id} className={`rounded-2xl border border-line bg-card p-4 ${e.archived ? "opacity-60" : ""}`}>
              {editing === e.id ? (
                <ExerciseForm initial={e} groups={groupsList} submitLabel="Save changes" onCancel={() => setEditing(null)}
                  onSubmit={async (d) => {
                    setErr("");
                    try { await api.put(`/api/exercises/${e.id}`, d); setEditing(null); await load(); }
                    catch (ex) { setErr((ex as Error).message); throw ex; }
                  }} />
              ) : (
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.name}</span><span className="chip">{e.equipment}</span>
                      {e.group_ids.map(groupName).filter(Boolean).map((gn) => (
                        <span key={gn} className="chip text-mint">{gn}</span>
                      ))}
                      {e.archived && <span className="chip">Archived</span>}
                    </div>
                    {e.notes && <p className="mt-1 text-xs text-muted">{e.notes}</p>}
                  </div>
                  <button type="button" className="btn" aria-label={`Edit ${e.name}`} onClick={() => setEditing(e.id)}><Pencil size={14} /></button>
                  <button type="button" className="btn" aria-label={e.archived ? `Restore ${e.name}` : `Archive ${e.name}`}
                    onClick={async () => {
                      setErr("");
                      try { await api.put(`/api/exercises/${e.id}`, { archived: !e.archived }); await load(); }
                      catch (ex) { setErr((ex as Error).message); }
                    }}>
                    {e.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  </button>
                  <button type="button" className="btn" aria-label={`Delete ${e.name}`}
                    onClick={() => setConfirmDelete(e)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      ))}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete exercise?"
        message={confirmDelete ? `Delete "${confirmDelete.name}" and all its workout history? This can't be undone.` : ""}
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (!target) return;
          setErr("");
          try { await api.del(`/api/exercises/${target.id}`); await load(); }
          catch (ex) { setErr((ex as Error).message); }
        }}
      />
    </div>
  );
}
