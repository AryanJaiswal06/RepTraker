import { useEffect, useState } from "react";
import { Dumbbell, Eye, EyeOff, Mail, Moon, Sun } from "lucide-react";
import { api } from "../api";
import { useSettings } from "../settings";
import { AuthProviders, User } from "../types";

type AuthMode = "login" | "register";

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z" />
      <path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z" />
    </svg>
  );
}

export default function Auth({ onSuccess }: { onSuccess: (u: User) => void }) {
  const { s, set } = useSettings();
  const [mode, setMode] = useState<AuthMode>("login");
  const [providers, setProviders] = useState<AuthProviders>({ google_enabled: false, smtp_enabled: false });
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const [verifyStep, setVerifyStep] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get<AuthProviders>("/api/auth/providers").then(setProviders).catch(() => {});
    const params = new URLSearchParams(window.location.search);
    const authErr = params.get("auth_error");
    if (authErr) {
      setErr(authErr);
      params.delete("auth_error");
      const clean = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (clean ? `?${clean}` : ""));
    }
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  function switchMode(next: AuthMode) {
    setMode(next);
    setErr("");
    setVerifyStep(false);
    setOtpCode("");
    setDevOtp(null);
    setShowGoogleSetup(false);
  }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!email.trim()) {
      setErr("Email is required");
      return;
    }
    if (!password) {
      setErr("Password is required");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ user: User }>("/api/auth/login", { email, password });
      onSuccess(res.user);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function startSignupOtp() {
    setErr("");
    if (!name.trim()) {
      setErr("Name is required");
      return;
    }
    if (!email.trim()) {
      setErr("Email is required");
      return;
    }
    if (password.length < 8) {
      setErr("Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; dev_otp?: string }>("/api/auth/register/start", {
        name,
        email,
        password,
      });
      setVerifyStep(true);
      setOtpCode("");
      setDevOtp(res.dev_otp ?? null);
      setCooldown(30);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!verifyStep) {
      await startSignupOtp();
      return;
    }
    setErr("");
    if (!/^\d{6}$/.test(otpCode.trim())) {
      setErr("Enter the 6-digit verification code");
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<{ user: User }>("/api/auth/register/verify", {
        name,
        email,
        password,
        code: otpCode.trim(),
      });
      onSuccess(res.user);
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleGoogleClick() {
    setErr("");
    if (providers.google_enabled) {
      window.location.href = "/api/auth/google/start";
    } else {
      setShowGoogleSetup((v) => !v);
    }
  }

  return (
    <div className="relative mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <button
          type="button"
          className="btn"
          aria-label={s.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          onClick={() => set({ theme: s.theme === "dark" ? "light" : "dark" })}
        >
          {s.theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>

      <div className="grid items-center gap-8 md:grid-cols-2">
        {/* Left Hero (Kinetic Pro) */}
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-mint">
            <Dumbbell size={14} /> RepTrack
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Every rep counted.<br />
              <span className="text-accent">Every PR tracked.</span>
            </h1>
            <p className="text-sm leading-relaxed text-muted">
              Sign in with Google or email &amp; password. New accounts verify their email with a 6-digit code before entering the workout tracker.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2.5 pt-1">
            <div className="rounded-2xl border border-line bg-card p-3">
              <div className="text-sm font-semibold text-mint">Verified</div>
              <div className="mt-0.5 text-xs text-muted">OTP on sign up</div>
            </div>
            <div className="rounded-2xl border border-line bg-card p-3">
              <div className="text-sm font-semibold text-accent">Google</div>
              <div className="mt-0.5 text-xs text-muted">1-click OAuth</div>
            </div>
            <div className="rounded-2xl border border-line bg-card p-3">
              <div className="text-sm font-semibold">Analytics</div>
              <div className="mt-0.5 text-xs text-muted">Charts &amp; streaks</div>
            </div>
          </div>
        </div>

        {/* Right Card (Strive Studio) */}
        <div className="space-y-4 rounded-2xl border border-line bg-card p-6 shadow-xl">
          <div>
            <h2 className="text-lg font-semibold">
              {mode === "login" ? "Welcome back" : verifyStep ? "Verify your email" : "Create your account"}
            </h2>
            <p className="text-xs text-muted">
              {mode === "login"
                ? "Sign in with Google or your email and password."
                : verifyStep
                  ? "Enter the 6-digit code sent to your email to finish creating your account."
                  : "We'll send a 6-digit verification code to confirm your email."}
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleClick}
            className="btn w-full justify-center border-line bg-raised py-2.5 text-sm font-medium hover:border-accent"
          >
            <GoogleIcon /> Continue with Google
          </button>

          {showGoogleSetup && !providers.google_enabled && (
            <div className="space-y-1.5 rounded-xl border border-line bg-raised/70 p-3 text-xs text-muted">
              <p className="font-medium text-fg">Google OAuth setup required</p>
              <p>
                Set <code className="text-fg">GOOGLE_CLIENT_ID</code> and <code className="text-fg">GOOGLE_CLIENT_SECRET</code> in the backend environment, and add this authorized redirect URI in Google Cloud Console:
              </p>
              <code className="block break-all rounded-lg bg-bg px-2 py-1 text-[11px] text-mint">
                {window.location.origin}/api/auth/google/callback
              </code>
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" />
            <span>or</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="grid grid-cols-2 rounded-xl border border-line bg-raised p-1">
            {(["login", "register"] as const).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => switchMode(m)}
                className={`rounded-lg py-1.5 text-sm font-medium transition-colors ${
                  mode === m ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg"
                }`}
              >
                {m === "login" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          {mode === "login" ? (
            <form className="space-y-3" onSubmit={submitLogin}>
              <div>
                <label className="mb-1 block text-xs text-muted" htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted" htmlFor="login-password">Password</label>
                <div className="relative">
                  <input
                    id="login-password"
                    className="input pr-10"
                    type={showPw ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    onClick={() => setShowPw((v) => !v)}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {err && <p role="alert" className="text-sm text-red-400">{err}</p>}

              <button className="btn-primary w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={submitRegister}>
              {!verifyStep ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-muted" htmlFor="reg-name">Name</label>
                    <input
                      id="reg-name"
                      className="input"
                      type="text"
                      autoComplete="name"
                      placeholder="Alex"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted" htmlFor="reg-email">Email</label>
                    <input
                      id="reg-email"
                      className="input"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-muted" htmlFor="reg-password">Password</label>
                    <div className="relative">
                      <input
                        id="reg-password"
                        className="input pr-10"
                        type={showPw ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder="At least 8 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                      <button
                        type="button"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-fg"
                        aria-label={showPw ? "Hide password" : "Show password"}
                        onClick={() => setShowPw((v) => !v)}
                      >
                        {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {err && <p role="alert" className="text-sm text-red-400">{err}</p>}

                  <button className="btn-primary w-full" disabled={busy}>
                    <Mail size={15} /> {busy ? "Sending code…" : "Send verification code"}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Code sent to <b className="text-fg">{email}</b></span>
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() => { setVerifyStep(false); setOtpCode(""); setDevOtp(null); setErr(""); }}
                    >
                      Edit details
                    </button>
                  </div>

                  {devOtp && (
                    <div className="flex items-center justify-between rounded-xl border border-mint/30 bg-mint/10 px-3 py-2 text-xs">
                      <span className="text-mint">
                        SMTP not configured · local code: <b className="num">{devOtp}</b>
                      </span>
                      <button
                        type="button"
                        className="font-semibold text-mint underline"
                        onClick={() => setOtpCode(devOtp)}
                      >
                        Fill
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="mb-1 block text-xs text-muted" htmlFor="reg-otp">6-digit verification code</label>
                    <input
                      id="reg-otp"
                      className="input num text-center text-base tracking-[0.35em]"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      placeholder="000000"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    />
                  </div>

                  {err && <p role="alert" className="text-sm text-red-400">{err}</p>}

                  <button className="btn-primary w-full" disabled={busy || otpCode.length !== 6}>
                    {busy ? "Creating account…" : "Verify & create account"}
                  </button>

                  <button
                    type="button"
                    className="btn w-full text-xs"
                    disabled={busy || cooldown > 0}
                    onClick={startSignupOtp}
                  >
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
                  </button>
                </>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
