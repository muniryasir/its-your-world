import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { login, signup } from "wasp/client/auth";
import { HomePlanet } from "./art/Planets";

export type AuthMode = "login" | "signup";

const DEMO = { username: "demo", password: "demo1234" };

/**
 * Log in / create account panel, shown over the home page.
 * Uses Wasp's login/signup functions; only the UI is ours.
 */
export function AuthPanel({ mode, onModeChange, onClose }: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";

  // Open as a modal once mounted (keeps focus inside, Esc closes it).
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => setError(null), [mode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const name = username.trim();
    if (!name) return setError("Enter a username.");
    if (isSignup && (password.length < 8 || !/\d/.test(password))) {
      return setError("Use at least 8 characters for your password, including a number.");
    }
    setBusy(true);
    try {
      if (isSignup) await signup({ username: name, password });
      await login({ username: name, password });
      navigate("/world");
    } catch (err) {
      setError(friendlyError(err, isSignup));
      setBusy(false);
    }
  }

  function useDemo() {
    setUsername(DEMO.username);
    setPassword(DEMO.password);
    setError(null);
  }

  return (
    <dialog
      ref={dialog}
      className="auth-panel"
      aria-labelledby="auth-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose(); // backdrop click
      }}
    >
      <div className="auth-panel-inner">
        <button type="button" className="auth-close" onClick={onClose} aria-label="Close">×</button>
        <svg className="auth-planet" viewBox="-60 -60 120 120" aria-hidden="true">
          <HomePlanet r={30} id="auth-home" />
        </svg>
        <h2 id="auth-title">{isSignup ? "Create your account" : "Welcome back"}</h2>
        <p className="auth-sub">
          {isSignup ? "One account for every app in your world." : "Log in to open your world."}
        </p>

        <form onSubmit={onSubmit} noValidate>
          <label className="auth-field">
            <span>Username</span>
            <input
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
          </label>
          <label className="auth-field">
            <span>Password</span>
            <span className="auth-password">
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={isSignup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={isSignup ? "pw-hint" : undefined}
                required
              />
              <button
                type="button"
                className="auth-reveal"
                onClick={() => setShowPassword((v) => !v)}
                aria-pressed={showPassword}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
            {isSignup && <small id="pw-hint">At least 8 characters, including a number.</small>}
          </label>

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button type="submit" className="home-btn home-btn--primary auth-submit" disabled={busy}>
            {busy ? (isSignup ? "Creating account…" : "Logging in…") : isSignup ? "Create account" : "Log in"}
          </button>
        </form>

        {!isSignup && (
          <div className="auth-demo">
            <span>Just looking? Use the demo account.</span>
            <button type="button" className="auth-link" onClick={useDemo}>Fill in demo login</button>
          </div>
        )}

        <p className="auth-switch-line">
          {isSignup ? "Already have an account?" : "New here?"}{" "}
          <button type="button" className="auth-link" onClick={() => onModeChange(isSignup ? "login" : "signup")}>
            {isSignup ? "Log in" : "Create an account"}
          </button>
        </p>
      </div>
    </dialog>
  );
}

function friendlyError(err: unknown, isSignup: boolean): string {
  const e = err as { statusCode?: number; message?: string; data?: { data?: { message?: string }; message?: string } };
  const detail = `${e?.data?.data?.message ?? ""} ${e?.data?.message ?? ""} ${e?.message ?? ""}`.toLowerCase();
  if (isSignup && detail.includes("already exists")) return "That username is taken. Try another one.";
  if (detail.includes("password must")) return "Use at least 8 characters for your password, including a number.";
  if (!isSignup && (e?.statusCode === 401 || detail.includes("invalid credentials"))) {
    return "That username and password don't match. Check them and try again.";
  }
  if (e?.statusCode === undefined || e.statusCode >= 500) return "Something went wrong on our side. Try again in a moment.";
  return e?.message || "Something went wrong. Try again.";
}
