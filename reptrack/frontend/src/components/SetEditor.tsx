import { useEffect, useState } from "react";
import { Check, Minus, Plus, Trophy } from "lucide-react";
import { SetRow } from "../types";
import { fromDisplay, toDisplay, useSettings } from "../settings";

type Props = {
  sets: SetRow[];
  onChange: (s: SetRow[]) => void;
  prev?: SetRow[];            // last saved session, shown as a "Previous" column
  prWeight?: number | null;   // best stored weight (kg), used for the new-best note
  onSetDone?: () => void;
};

function NumInput({ value, decimal, ariaLabel, onCommit }: {
  value: number;
  decimal?: boolean;
  ariaLabel: string;
  onCommit: (n: number) => void;
}) {
  const [raw, setRaw] = useState(value ? String(value) : "");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(value ? String(value) : "");
  }, [value, focused]);

  const pattern = decimal ? /^\d*\.?\d*$/ : /^\d*$/;

  return (
    <input
      className="input num"
      type="text"
      inputMode={decimal ? "decimal" : "numeric"}
      placeholder="0"
      aria-label={ariaLabel}
      value={raw}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const n = decimal ? parseFloat(raw) || 0 : parseInt(raw, 10) || 0;
        onCommit(Math.max(0, n));
      }}
      onChange={(e) => {
        const next = e.target.value;
        if (!pattern.test(next)) return;
        setRaw(next);
        const n = next === "" || next === "." ? 0 : (decimal ? parseFloat(next) : parseInt(next, 10)) || 0;
        onCommit(Math.max(0, n));
      }}
    />
  );
}

export default function SetEditor({ sets, onChange, prev, prWeight, onSetDone }: Props) {
  const { s } = useSettings();
  const patch = (i: number, p: Partial<SetRow>) => onChange(sets.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const cols = prev
    ? "grid-cols-[1.25rem_4.75rem_1fr_1fr_2.25rem_1.25rem]"
    : "grid-cols-[1.5rem_1fr_1fr_2.25rem_2rem]";
  const prDisplay = prWeight && prWeight > 0 ? toDisplay(prWeight, s.unit) : null;
  const best = prDisplay != null
    ? Math.max(0, ...sets.filter((r) => r.done && r.reps > 0 && toDisplay(r.weight, s.unit) > prDisplay).map((r) => r.weight))
    : 0;

  return (
    <div className="space-y-2">
      <div className={`grid ${cols} items-center gap-2 px-0.5 text-xs text-muted`}>
        <span>Set</span>{prev && <span>Previous</span>}<span>Weight ({s.unit})</span><span>Reps</span><span /><span />
      </div>
      {sets.map((r, i) => (
        <div key={i} className={`grid ${cols} items-center gap-2`}>
          <span className="num text-sm text-muted">{i + 1}</span>
          {prev && (
            <span className="num text-xs text-muted">
              {prev[i] ? `${toDisplay(prev[i].weight, s.unit)} × ${prev[i].reps}` : "–"}
            </span>
          )}
          <NumInput
            decimal
            ariaLabel={`Set ${i + 1} weight`}
            value={toDisplay(r.weight, s.unit)}
            onCommit={(n) => patch(i, { weight: fromDisplay(n, s.unit) })}
          />
          <NumInput
            ariaLabel={`Set ${i + 1} reps`}
            value={r.reps}
            onCommit={(n) => patch(i, { reps: Math.round(n) })}
          />
          <button type="button" aria-label={r.done ? "Mark set not done" : "Mark set done"} aria-pressed={r.done}
            onClick={() => { patch(i, { done: !r.done }); if (!r.done) onSetDone?.(); }}
            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-colors ${
              r.done ? "border-mint bg-mint text-black" : "border-line bg-raised text-muted hover:text-fg"}`}>
            <Check size={16} />
          </button>
          <button type="button" aria-label="Remove set" className="text-muted hover:text-fg"
            onClick={() => onChange(sets.filter((_, j) => j !== i))}>
            <Minus size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="btn w-full" onClick={() => {
        const last = sets[sets.length - 1];
        onChange([...sets, { weight: last?.weight ?? 0, reps: last?.reps ?? 0, done: false }]);
      }}>
        <Plus size={14} /> Add set
      </button>
      {best > 0 && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-mint">
          <Trophy size={13} /> New best weight: {toDisplay(best, s.unit)} {s.unit}
        </p>
      )}
    </div>
  );
}
