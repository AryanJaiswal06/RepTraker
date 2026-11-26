import { useEffect, useState } from "react";
import { EQUIPMENT, Exercise, Group, MUSCLES } from "../types";

export type ExerciseDraft = Pick<Exercise, "name" | "muscle_group" | "equipment" | "notes" | "group_ids">;
type Props = {
  initial?: ExerciseDraft;
  groups?: Group[];
  defaultGroupIds?: number[];
  submitLabel: string;
  onSubmit: (d: ExerciseDraft) => Promise<void> | void;
  onCancel?: () => void;
};

export default function ExerciseForm({ initial, groups, defaultGroupIds, submitLabel, onSubmit, onCancel }: Props) {
  const [d, setD] = useState<ExerciseDraft>(
    initial ?? { name: "", muscle_group: "Chest", equipment: "Barbell", notes: "", group_ids: defaultGroupIds ?? [] }
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initial && defaultGroupIds) {
      setD((prev) => ({ ...prev, group_ids: defaultGroupIds }));
    }
  }, [initial, defaultGroupIds]);

  const toggleGroup = (id: number) =>
    setD((prev) => ({
      ...prev,
      group_ids: prev.group_ids.includes(id) ? prev.group_ids.filter((g) => g !== id) : [...prev.group_ids, id],
    }));

  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      if (!d.name.trim()) return;
      setBusy(true);
      try {
        await onSubmit(d);
        if (!initial) setD((prev) => ({ ...prev, name: "", notes: "" }));
      } finally {
        setBusy(false);
      }
    }}>
      <input className="input" placeholder="Exercise name" aria-label="Exercise name" value={d.name}
        onChange={(e) => setD({ ...d, name: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <select className="input" aria-label="Muscle group" value={d.muscle_group}
          onChange={(e) => setD({ ...d, muscle_group: e.target.value })}>
          {MUSCLES.map((m) => <option key={m}>{m}</option>)}
        </select>
        <select className="input" aria-label="Equipment" value={d.equipment}
          onChange={(e) => setD({ ...d, equipment: e.target.value })}>
          {EQUIPMENT.map((m) => <option key={m}>{m}</option>)}
        </select>
      </div>
      <input className="input" placeholder="Notes (optional)" aria-label="Notes" value={d.notes}
        onChange={(e) => setD({ ...d, notes: e.target.value })} />
      {groups && groups.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs text-muted">Groups (optional)</p>
          <div className="flex flex-wrap gap-1.5">
            {groups.map((g) => {
              const on = d.group_ids.includes(g.id);
              return (
                <button type="button" key={g.id} aria-pressed={on} onClick={() => toggleGroup(g.id)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                    on ? "border-accent bg-accent font-medium text-white" : "border-line text-muted hover:text-fg"}`}>
                  {g.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !d.name.trim()}>{submitLabel}</button>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
