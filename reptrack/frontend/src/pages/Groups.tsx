import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import { Exercise, Group } from "../types";

function GroupForm({ exercises, initial, onSubmit, onCancel }: {
  exercises: Exercise[]; initial?: Group; onSubmit: (name: string, ids: number[]) => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [ids, setIds] = useState<number[]>(initial?.exercise_ids ?? []);
  const [busy, setBusy] = useState(false);
  const toggle = (id: number) => setIds((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id]));
  const visible = exercises.filter((e) => !e.archived || ids.includes(e.id));

  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (!name.trim()) return;
      setBusy(true);
      try { await onSubmit(name.trim(), ids); } finally { setBusy(false); }
    }}>
      <input className="input" placeholder="Group name, e.g. Push day" aria-label="Group name" value={name}
        onChange={(e) => setName(e.target.value)} />
      <div>
        <p className="mb-2 text-xs text-muted">Choose exercises ({ids.length} selected)</p>
        <div className="flex flex-wrap gap-2">
          {visible.map((e) => (
            <button type="button" key={e.id} aria-pressed={ids.includes(e.id)} onClick={() => toggle(e.id)}
              className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                ids.includes(e.id) ? "border-accent bg-accent font-medium text-white" : "border-line text-muted hover:text-fg"}`}>
              {e.name}{e.archived ? " (archived)" : ""}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !name.trim()}>Save group</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function Groups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Group | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const [g, e] = await Promise.all([api.get<Group[]>("/api/groups"), api.get<Exercise[]>("/api/exercises?archived=1")]);
      setGroups(g);
      setExercises(e);
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  const labelOf = (id: number) => {
    const ex = exercises.find((e) => e.id === id);
    return ex ? (ex.archived ? `${ex.name} (archived)` : ex.name) : undefined;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Groups</h1>
          <p className="text-xs text-muted">Organize exercises into routines to filter your Dashboard.</p>
        </div>
        <button type="button" className="btn-primary shrink-0" onClick={() => setEditing("new")}><Plus size={15} /> New group</button>
      </div>
      {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
      {editing === "new" && (
        <div className="rounded-2xl border border-line bg-card p-4">
          <GroupForm exercises={exercises} onCancel={() => setEditing(null)}
            onSubmit={async (name, exercise_ids) => {
              setErr("");
              try { await api.post("/api/groups", { name, exercise_ids }); setEditing(null); await load(); }
              catch (e) { setErr((e as Error).message); }
            }} />
        </div>
      )}
      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Loading groups…</p>
      ) : !groups.length && editing !== "new" && (
        <p className="py-10 text-center text-sm text-muted">No groups yet. Create one like "Push day" or "Leg day".</p>
      )}
      {groups.map((g) => (
        <div key={g.id} className="rounded-2xl border border-line bg-card p-4">
          {editing === g.id ? (
            <GroupForm exercises={exercises} initial={g} onCancel={() => setEditing(null)}
              onSubmit={async (name, exercise_ids) => {
                setErr("");
                try { await api.put(`/api/groups/${g.id}`, { name, exercise_ids }); setEditing(null); await load(); }
                catch (e) { setErr((e as Error).message); }
              }} />
          ) : (
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{g.name} <span className="num text-xs font-normal text-muted">{g.exercise_ids.length} exercises</span></div>
                <p className="mt-1 text-sm text-muted">{g.exercise_ids.map(labelOf).filter(Boolean).join(", ") || "Empty group"}</p>
              </div>
              <button type="button" className="btn" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g.id)}><Pencil size={14} /></button>
              <button type="button" className="btn" aria-label={`Delete ${g.name}`}
                onClick={() => setConfirmDelete(g)}>
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </div>
      ))}

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete group?"
        message={confirmDelete ? `Delete the group "${confirmDelete.name}"? Its exercises and history are kept.` : ""}
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (!target) return;
          setErr("");
          try { await api.del(`/api/groups/${target.id}`); await load(); }
          catch (e) { setErr((e as Error).message); }
        }}
      />
    </div>
  );
}
