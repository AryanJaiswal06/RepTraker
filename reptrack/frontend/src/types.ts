export type User = {
  id: number;
  email: string;
  name: string;
  has_password?: boolean;
  auth_provider?: string;
  email_verified?: boolean;
};
export type AuthProviders = { google_enabled: boolean; smtp_enabled: boolean };
export type SetRow = { weight: number; reps: number; done: boolean }; // weight stored in kg
export type Session = { id: number; exercise_id: number; exercise_name: string; performed_at: string; sets: SetRow[] };
export type Stats = {
  last_weight: number | null; last_reps: number | null; max_weight: number | null;
  total_sessions: number; last_date: string | null;
};
export type ProgressPoint = {
  date: string;
  best_weight: number;
  volume: number;
  est_1rm: number;
};
export type Exercise = {
  id: number; name: string; muscle_group: string; equipment: string; notes: string; archived: boolean; group_ids: number[];
};
export type Group = { id: number; name: string; exercise_ids: number[] };
export type DashboardExercise = Exercise & { last_session: Session | null; stats: Stats; history: ProgressPoint[] };
export type AnalyticsResponse = { workout_dates: string[] };

export const MUSCLES = ["Chest", "Back", "Shoulders", "Biceps", "Triceps", "Legs", "Glutes", "Core", "Full body", "Other"];
export const EQUIPMENT = ["Barbell", "Dumbbell", "Cable", "Machine", "Bodyweight", "Other"];
