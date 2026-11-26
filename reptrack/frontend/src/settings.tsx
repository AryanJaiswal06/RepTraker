import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Unit = "kg" | "lb";
type Settings = { theme: "dark" | "light"; unit: Unit; defaultSets: number; restSeconds: number };
const DEFAULTS: Settings = { theme: "dark", unit: "kg", defaultSets: 3, restSeconds: 90 };
const KEY = "reptrack:settings";

function normalize(raw: Partial<Settings>): Settings {
  const theme = raw.theme === "light" || raw.theme === "dark" ? raw.theme : DEFAULTS.theme;
  const unit = raw.unit === "lb" || raw.unit === "kg" ? raw.unit : DEFAULTS.unit;
  const defaultSets = Number.isFinite(raw.defaultSets)
    ? Math.min(10, Math.max(1, Math.round(raw.defaultSets!)))
    : DEFAULTS.defaultSets;
  const restSeconds = Number.isFinite(raw.restSeconds)
    ? Math.min(600, Math.max(0, Math.round(raw.restSeconds!)))
    : DEFAULTS.restSeconds;
  return { theme, unit, defaultSets, restSeconds };
}

const Ctx = createContext<{ s: Settings; set: (p: Partial<Settings>) => void }>({ s: DEFAULTS, set: () => {} });
export const useSettings = () => useContext(Ctx);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(() => {
    try {
      return normalize(JSON.parse(localStorage.getItem(KEY) || "{}"));
    } catch {
      return DEFAULTS;
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", s.theme === "light" ? "#f6f7fb" : "#0d0f14");
    localStorage.setItem(KEY, JSON.stringify(s));
  }, [s]);
  return <Ctx.Provider value={{ s, set: (p) => setS((o) => normalize({ ...o, ...p })) }}>{children}</Ctx.Provider>;
}

const LB = 2.20462;
const round = (n: number) => Math.round(n * 10) / 10;
export const toDisplay = (kg: number, u: Unit) => round(u === "lb" ? kg * LB : kg);
export const fromDisplay = (v: number, u: Unit) => (u === "lb" ? v / LB : v);
export const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "Never";
