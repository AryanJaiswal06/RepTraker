import { useEffect, useState } from "react";
import { Dumbbell, History as HistoryIcon, LayoutDashboard, Layers, LogOut, Moon, Settings as SettingsIcon, Sun } from "lucide-react";
import { api, setUnauthorizedHandler } from "./api";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Exercises from "./pages/Exercises";
import Groups from "./pages/Groups";
import History from "./pages/History";
import SettingsPage from "./pages/Settings";
import { useSettings } from "./settings";
import { User } from "./types";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "exercises", label: "Exercises", icon: Dumbbell },
  { id: "groups", label: "Groups", icon: Layers },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;
type Tab = (typeof TABS)[number]["id"];

function AuthenticatedApp({ user, onUserUpdated, onLogout }: { user: User; onUserUpdated: (u: User) => void; onLogout: () => Promise<void> }) {
  const { s, set } = useSettings();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [resetKey, setResetKey] = useState(0);

  return (
    <div className="min-h-screen md:flex">
      {/* Desktop Sidebar (Kinetic Pro) */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:justify-between md:border-r md:border-line md:bg-card md:p-4">
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-mint text-white shadow-sm">
                <Dumbbell size={16} />
              </div>
              <span className="text-base font-semibold tracking-tight">RepTrack</span>
            </div>
            <button
              type="button"
              onClick={() => set({ theme: s.theme === "dark" ? "light" : "dark" })}
              aria-label={s.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-fg"
            >
              {s.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>

          <nav className="space-y-1" aria-label="Main">
            {TABS.map(({ id, label, icon: I }) => {
              const active = tab === id;
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => setTab(id)}
                  aria-current={active ? "page" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-accent/15 text-accent" : "text-muted hover:bg-raised hover:text-fg"
                  }`}
                >
                  <I size={16} />
                  {label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-raised/70 p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            title="Sign out"
            aria-label="Sign out"
            className="shrink-0 rounded-lg p-1.5 text-muted hover:bg-card hover:text-fg"
          >
            <LogOut size={15} />
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/90 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-mint text-white">
            <Dumbbell size={14} />
          </div>
          <span className="text-base font-semibold tracking-tight">RepTrack</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => set({ theme: s.theme === "dark" ? "light" : "dark" })}
            aria-label={s.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-fg"
          >
            {s.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
            className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-fg"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 pt-5 md:px-8 md:py-7">
        <div className={tab === "dashboard" ? "" : "hidden"}>
          <Dashboard userId={user.id} active={tab === "dashboard"} resetKey={resetKey} />
        </div>
        {tab === "exercises" && <Exercises />}
        {tab === "groups" && <Groups />}
        {tab === "history" && <History />}
        {tab === "settings" && <SettingsPage user={user} onUserUpdated={onUserUpdated} onLogout={onLogout} onRestored={() => setResetKey((k) => k + 1)} />}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-line bg-bg/95 backdrop-blur md:hidden" aria-label="Main">
        {TABS.map(({ id, label, icon: I }) => (
          <button type="button" key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-xs ${tab === id ? "text-accent" : "text-muted"}`}>
            <I size={18} /> {label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.get<{ user: User | null }>("/api/auth/me")
      .then((res) => setUser(res.user))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setChecking(false));
    return () => setUnauthorizedHandler(null);
  }, []);

  async function handleLogout() {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setUser(null);
    }
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted">
        Loading RepTrack…
      </div>
    );
  }

  if (err && !user) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
        <div className="w-full space-y-3 rounded-2xl border border-line bg-card p-6">
          <p className="text-sm text-red-400">{err}</p>
          <button type="button" className="btn-primary w-full" onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (!user) return <Auth onSuccess={setUser} />;
  return <AuthenticatedApp key={user.id} user={user} onUserUpdated={setUser} onLogout={handleLogout} />;
}
