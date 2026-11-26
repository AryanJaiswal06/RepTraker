import { useEffect, useRef, useState } from "react";
import { Download, KeyRound, LogOut, Upload } from "lucide-react";
import { api } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import { useSettings } from "../settings";
import { User } from "../types";

const Seg = <T extends string>({ value, options, onChange }: { value: T; options: T[]; onChange: (v: T) => void }) => (
  <div className="flex rounded-xl border border-line bg-raised p-0.5">
    {options.map((o) => (
      <button type="button" key={o} onClick={() => onChange(o)} aria-pressed={value === o}
        className={`rounded-lg px-3 py-1 text-sm capitalize transition-colors ${value === o ? "bg-accent font-medium text-white shadow-sm" : "text-muted hover:text-fg"}`}>{o}</button>
    ))}
  </div>
);

function BoundedIntInput({ value, min, max, fallback, ariaLabel, onCommit }: {
  value: number; min: number; max: number; fallback: number; ariaLabel: string; onCommit: (n: number) => void;
}) {
  const [raw, setRaw] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setRaw(String(value));
  }, [value, focused]);

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      className="input num w-20"
      value={raw}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const parsed = parseInt(raw, 10);
        const next = Number.isNaN(parsed) ? fallback : Math.min(max, Math.max(min, parsed));
        onCommit(next);
        setRaw(String(next));
      }}
      onChange={(e) => {
        const next = e.target.value;
        if (!/^\d*$/.test(next)) return;
        setRaw(next);
        if (next !== "") {
          const parsed = parseInt(next, 10);
          if (parsed >= min && parsed <= max) onCommit(parsed);
        }
      }}
    />
  );
}

export default function SettingsPage({ user, onUserUpdated, onLogout, onRestored }: {
  user: User;
  onUserUpdated?: (u: User) => void;
  onLogout: () => Promise<void>;
  onRestored?: () => void;
}) {
  const { s, set } = useSettings();
  const file = useRef<HTMLInputElement>(null);
  const [pendingBackup, setPendingBackup] = useState<unknown | null>(null);
  const [status, setStatus] = useState<{ text: string; err?: boolean } | null>(null);
  const [changingPw, setChangingPw] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  async function exportData() {
    setStatus(null);
    try {
      const data = await api.get<unknown>("/api/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `reptrack-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setStatus({ text: `Couldn't export: ${(e as Error).message}`, err: true });
    }
  }

  async function prepareImport(f: File) {
    setStatus(null);
    try {
      const parsed = JSON.parse(await f.text()) as { exercises?: unknown };
      if (!parsed || !Array.isArray(parsed.exercises)) {
        setStatus({ text: "Couldn't restore: Not a valid RepTrack backup file", err: true });
        return;
      }
      setPendingBackup(parsed);
    } catch (e) {
      setStatus({ text: `Couldn't restore: ${(e as Error).message}`, err: true });
    }
  }

  async function confirmImport() {
    const payload = pendingBackup;
    setPendingBackup(null);
    if (!payload) return;
    try {
      await api.post("/api/import", payload);
      localStorage.removeItem(`reptrack:drafts:${user.id}`);
      onRestored?.();
      setStatus({ text: "Backup restored" });
    } catch (e) {
      setStatus({ text: `Couldn't restore: ${(e as Error).message}`, err: true });
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    if (newPw.length < 8) {
      setStatus({ text: "New password must be at least 8 characters", err: true });
      return;
    }
    setPwBusy(true);
    try {
      const res = await api.put<{ user: User }>("/api/auth/password", { current_password: curPw, new_password: newPw });
      if (res?.user) onUserUpdated?.(res.user);
      setCurPw("");
      setNewPw("");
      setChangingPw(false);
      setStatus({ text: user.has_password ? "Password updated" : "Password set" });
    } catch (ex) {
      setStatus({ text: (ex as Error).message, err: true });
    } finally {
      setPwBusy(false);
    }
  }

  const Row = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-4 p-4">
      <div><div className="text-sm font-medium">{label}</div>{hint && <div className="text-xs text-muted">{hint}</div>}</div>
      {children}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="text-xs text-muted">Account, workout preferences, and backups.</p>
      </div>
      <section className="divide-y divide-line rounded-2xl border border-line bg-card">
        <Row label={user.name} hint={`${user.email}${user.email_verified ? " · Verified" : ""}`}>
          <div className="flex gap-2">
            <button type="button" className="btn" onClick={() => setChangingPw((v) => !v)}>
              <KeyRound size={14} /> {user.has_password === false ? "Set password" : "Password"}
            </button>
            <button type="button" className="btn" onClick={onLogout}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </Row>
        {changingPw && (
          <form className="space-y-3 p-4" onSubmit={submitPassword}>
            {user.has_password !== false && (
              <input className="input" type="password" autoComplete="current-password" placeholder="Current password"
                value={curPw} onChange={(e) => setCurPw(e.target.value)} />
            )}
            <input className="input" type="password" autoComplete="new-password" placeholder="New password (min 8 characters)"
              value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <div className="flex gap-2">
              <button className="btn-primary" disabled={pwBusy || (user.has_password !== false && !curPw) || !newPw}>
                {user.has_password === false ? "Set password" : "Update password"}
              </button>
              <button type="button" className="btn" onClick={() => setChangingPw(false)}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      <section className="divide-y divide-line rounded-2xl border border-line bg-card">
        <Row label="Theme"><Seg value={s.theme} options={["dark", "light"]} onChange={(theme) => set({ theme })} /></Row>
        <Row label="Weight unit" hint="Weights are stored in kg and converted for display.">
          <Seg value={s.unit} options={["kg", "lb"]} onChange={(unit) => set({ unit })} />
        </Row>
        <Row label="Rest timer" hint="Starts when you tick a set. Set 0 to turn it off.">
          <BoundedIntInput value={s.restSeconds} min={0} max={600} fallback={0} ariaLabel="Rest seconds"
            onCommit={(restSeconds) => set({ restSeconds })} />
        </Row>
        <Row label="Empty sets for new exercises" hint="Rows shown when an exercise has no history.">
          <BoundedIntInput value={s.defaultSets} min={1} max={10} fallback={3} ariaLabel="Default sets"
            onCommit={(defaultSets) => set({ defaultSets })} />
        </Row>
      </section>

      <section className="divide-y divide-line rounded-2xl border border-line bg-card">
        <Row label="Back up your data" hint="Download your exercises and history as a JSON file.">
          <button type="button" className="btn" onClick={exportData}><Download size={14} /> Export</button>
        </Row>
        <Row label="Restore from backup" hint="Replaces all data on your account.">
          <button type="button" className="btn" onClick={() => file.current?.click()}><Upload size={14} /> Import</button>
          <input ref={file} type="file" accept="application/json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) prepareImport(f); e.target.value = ""; }} />
        </Row>
      </section>
      {status && <p role="status" className={`text-sm font-medium ${status.err ? "text-red-400" : "text-mint"}`}>{status.text}</p>}

      <ConfirmDialog
        open={pendingBackup !== null}
        title="Restore backup?"
        message="Restoring a backup replaces all exercises, groups, and workout history on your account. Continue?"
        confirmLabel="Restore"
        onCancel={() => setPendingBackup(null)}
        onConfirm={confirmImport}
      />
    </div>
  );
}
