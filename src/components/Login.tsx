import { useState, useRef, useSyncExternalStore, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  Eye,
  EyeOff,
  Layers3,
  Loader2,
  LockKeyhole,
  Pause,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api } from "../lib/api";

function subscribeMotion(callback: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function StudioScene() {
  const reduced = useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true,
  );
  const [paused, setPaused] = useState(false);
  const scene = useRef<HTMLDivElement>(null);
  return (
    <aside
      className="studio-scene"
      data-paused={paused || reduced}
      onPointerMove={(event) => {
        if (reduced || paused) return;
        const rect = event.currentTarget.getBoundingClientRect();
        scene.current?.style.setProperty(
          "--pointer-x",
          `${((event.clientX - rect.left) / rect.width - 0.5) * 12}deg`,
        );
        scene.current?.style.setProperty(
          "--pointer-y",
          `${((event.clientY - rect.top) / rect.height - 0.5) * -10}deg`,
        );
      }}
      onPointerLeave={() => {
        scene.current?.style.setProperty("--pointer-x", "0deg");
        scene.current?.style.setProperty("--pointer-y", "0deg");
      }}
    >
      <div className="scene-topline">
        <span>
          <i /> AN INDEPENDENT DIGITAL STUDIO
        </span>
        <button
          type="button"
          className="motion-toggle"
          aria-label={paused ? "Play animation" : "Pause animation"}
          aria-pressed={paused}
          onClick={() => setPaused((v) => !v)}
          disabled={reduced}
        >
          {paused || reduced ? <Play size={12} /> : <Pause size={12} />}
          <span>{reduced ? "Reduced motion" : paused ? "Play" : "Pause"}</span>
        </button>
      </div>
      <div className="scene-art" ref={scene} aria-hidden="true">
        <div className="scene-grid" />
        <div className="scene-aurora aurora-cyan" />
        <div className="scene-aurora aurora-violet" />
        <svg className="scene-orbits" viewBox="0 0 700 600" fill="none">
          <defs>
            <linearGradient id="orbit-color">
              <stop stopColor="#54dfee" />
              <stop offset=".52" stopColor="#8095ff" />
              <stop offset="1" stopColor="#c58cf4" />
            </linearGradient>
          </defs>
          <ellipse
            cx="350"
            cy="298"
            rx="266"
            ry="202"
            transform="rotate(-25 350 298)"
          />
          <ellipse
            cx="350"
            cy="298"
            rx="288"
            ry="144"
            transform="rotate(33 350 298)"
          />
          <path
            className="orbit-beam"
            d="M50 358C185 78 542 57 647 301S272 627 85 295"
          />
          <circle className="orbit-satellite satellite-one" r="4">
            <animateMotion
              dur="14s"
              repeatCount="indefinite"
              path="M50 358C185 78 542 57 647 301S272 627 85 295Z"
            />
          </circle>
        </svg>
        <div className="scene-coordinate coordinate-a">01 / IMAGINE</div>
        <div className="scene-coordinate coordinate-b">02 / ASSEMBLE</div>
        <div className="scene-coordinate coordinate-c">03 / MAKE IT YOURS</div>
        <div className="scene-stage">
          <div className="glass-slab slab-back" />
          <div className="glass-slab slab-mid" />
          <div className="creative-browser">
            <div className="creative-browser-top">
              <span className="creative-dots">
                <i />
                <i />
                <i />
              </span>
              <span>your-next-chapter.site</span>
              <LockKeyhole size={10} />
            </div>
            <div className="creative-nav">
              <img src="/icon.svg" alt="" />
              <span />
              <span />
              <span />
            </div>
            <div className="creative-hero">
              <div className="creative-copy">
                <small>IDEAS, BEAUTIFULLY ENGINEERED.</small>
                <h3>
                  A little vision.
                  <br />
                  Endless <em>possibility.</em>
                </h3>
                <div className="creative-text-line" />
                <div className="creative-text-line short" />
                <span className="creative-cta">
                  Something extraordinary <ArrowUpRight size={10} />
                </span>
              </div>
              <div className="sculpture">
                <div className="sculpture-ring ring-back" />
                <div className="sculpture-ring ring-front" />
                <div className="sculpture-core" />
                <div className="sculpture-dot" />
              </div>
            </div>
            <div className="creative-tiles">
              <div>
                <Layers3 size={14} />
                <span>Thoughtful structure</span>
                <i />
              </div>
              <div>
                <Sparkles size={14} />
                <span>A distinct identity</span>
                <i />
              </div>
              <div>
                <Code2 size={14} />
                <span>Built with intention</span>
                <i />
              </div>
            </div>
            <div className="creative-browser-foot">
              <span>YOUR VISION. EVERY DETAIL.</span>
              <span>J / STUDIO</span>
            </div>
          </div>
        </div>
        <div className="scene-float float-code">
          <Code2 size={16} />
          <span>Crafted, not ordinary.</span>
          <i />
        </div>
        <div className="scene-float float-detail">
          <span className="detail-check">
            <Check size={14} />
          </span>
          <div>
            <strong>The details make the difference.</strong>
            <span>Let’s make yours count.</span>
          </div>
        </div>
        <div className="scene-float float-swatch">
          <i />
          <i />
          <i />
          <span>UNIQUELY YOU</span>
        </div>
        {Array.from({ length: 12 }, (_, i) => (
          <span
            key={i}
            className="scene-star"
            style={{
              left: `${8 + ((i * 29) % 86)}%`,
              top: `${12 + ((i * 19) % 76)}%`,
              animationDelay: `-${i * 0.7}s`,
            }}
          />
        ))}
      </div>
      <div className="scene-bottomline">
        <div>
          <span className="scene-kicker">WHERE IDEAS FIND THEIR FORM.</span>
          <p>
            Extraordinary starts
            <br />
            with <em>your story.</em>
          </p>
        </div>
        <span className="scene-signature">
          J0HNVEXCODER
          <br />
          <small>DESIGN · DEVELOPMENT · DETAIL</small>
        </span>
      </div>
    </aside>
  );
}
export function Login({
  notice,
  onSuccess,
  brand,
}: {
  notice: string;
  onSuccess: () => Promise<void>;
  brand: React.ReactNode;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [step, setStep] = useState<
      "login" | "totp" | "backup" | "request" | "reset"
    >("login"),
    [shown, setShown] = useState(false),
    [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const data = new FormData(event.currentTarget);
    try {
      if (step === "request") {
        const result = await api<{ message: string }>("/api/recovery/request", {
          method: "POST",
          body: JSON.stringify({ email: data.get("email") }),
        });
        setMessage(result.message);
      } else if (step === "reset") {
        const result = await api<{ message: string }>(
          "/api/recovery/complete",
          {
            method: "POST",
            body: JSON.stringify({
              token: data.get("token"),
              password: data.get("password"),
            }),
          },
        );
        setStep("login");
        setMessage(result.message);
      } else if (step === "totp" || step === "backup") {
        await api(
          step === "backup"
            ? "/api/auth/two-factor/verify-backup-code"
            : "/api/auth/two-factor/verify-totp",
          {
            method: "POST",
            body: JSON.stringify({
              code: data.get("code"),
              trustDevice: false,
            }),
          },
        );
        await onSuccess();
      } else {
        const result = await api<{ twoFactorRedirect?: boolean }>(
          "/api/auth/sign-in/email",
          {
            method: "POST",
            body: JSON.stringify({
              email: data.get("email"),
              password: data.get("password"),
              rememberMe: false,
            }),
          },
        );
        if (result.twoFactorRedirect) setStep("totp");
        else await onSuccess();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeStep(next: typeof step) {
    setStep(next);
    setError("");
    setMessage("");
  }
  const titles = {
    login: "Welcome to your workspace",
    totp: "One more secure step",
    backup: "Your recovery code",
    request: "Let’s get you back in",
    reset: "A fresh, secure start",
  };
  return (
    <div className="login-page login-redesign">
      <section className="login-left">
        <header className="compact-login-brand">
          {brand}
          <span className="login-access-label">
            <ShieldCheck size={12} /> PRIVATE ACCESS
          </span>
        </header>
        <main className="login-form">
          <span className="eyebrow">
            <span className="tiny-line" /> GOOD THINGS START HERE.
          </span>
          <h1>
            {titles[step]}
            <span>.</span>
          </h1>
          <p className="login-intro">
            {step === "login"
              ? "Your ideas. Your content. A clear path to a website that feels like you."
              : step === "totp"
                ? "Enter the six-digit code from your authenticator app."
                : step === "backup"
                  ? "Use one of the recovery codes you saved during setup."
                  : step === "request"
                    ? "John reviews account recovery through your agreed contact channel."
                    : "Enter the one-time token John shared, then choose a new credential."}
          </p>
          <form onSubmit={submit} key={step} aria-label="Workspace sign in">
            {(step === "login" || step === "request") && (
              <label htmlFor="login-email">
                Company email
                <input
                  id="login-email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  placeholder="you@yourcompany.test"
                  required
                />
              </label>
            )}
            {step === "reset" && (
              <label htmlFor="reset-token">
                One-time recovery token
                <input
                  id="reset-token"
                  name="token"
                  autoComplete="off"
                  maxLength={48}
                  required
                />
              </label>
            )}
            {(step === "login" || step === "reset") && (
              <label htmlFor="login-password">
                {step === "reset" ? "New credential" : "Access credential"}
                <span className="password-input">
                  <input
                    id="login-password"
                    name="password"
                    type={shown ? "text" : "password"}
                    autoComplete={
                      step === "reset" ? "new-password" : "current-password"
                    }
                    placeholder={
                      step === "reset"
                        ? "At least 16 characters"
                        : "Enter your secure credential"
                    }
                    minLength={step === "reset" ? 16 : undefined}
                    maxLength={128}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    aria-label={shown ? "Hide credential" : "Show credential"}
                    aria-pressed={shown}
                    onClick={() => setShown((v) => !v)}
                  >
                    {shown ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </span>
              </label>
            )}
            {(step === "totp" || step === "backup") && (
              <label htmlFor="login-code">
                {step === "totp" ? "Authenticator code" : "Recovery code"}
                <input
                  id="login-code"
                  name="code"
                  inputMode={step === "totp" ? "numeric" : "text"}
                  pattern={step === "totp" ? "[0-9]{6}" : undefined}
                  maxLength={step === "totp" ? 6 : 100}
                  autoComplete="one-time-code"
                  autoFocus
                  required
                />
              </label>
            )}
            {(error || notice) && (
              <p className="compact-login-message error" role="alert">
                {error || notice}
              </p>
            )}
            {message && (
              <p className="compact-login-message success" role="status">
                {message}
              </p>
            )}
            <button className="primary wide login-submit" disabled={busy}>
              {busy ? <Loader2 className="spin" size={17} /> : null}
              <span>
                {busy
                  ? "Please wait…"
                  : step === "request"
                    ? "Request recovery"
                    : step === "reset"
                      ? "Set new credential"
                      : step === "login"
                        ? "Enter workspace"
                        : "Verify & continue"}
              </span>
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="login-actions">
            {step === "login" ? (
              <>
                <span>
                  <LockKeyhole size={12} /> Your private project space
                </span>
                <button type="button" onClick={() => changeStep("request")}>
                  Need access help?
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => changeStep("login")}>
                  ← Back to sign in
                </button>
                {step === "totp" ? (
                  <button type="button" onClick={() => changeStep("backup")}>
                    Use a recovery code
                  </button>
                ) : step === "request" ? (
                  <button type="button" onClick={() => changeStep("reset")}>
                    I have a recovery token
                  </button>
                ) : null}
              </>
            )}
          </div>
          <div className="login-bottom-rule">
            <span />
            <Sparkles size={13} />
            <span />
          </div>
          <p className="login-footnote">
            <a
              href="https://johnvexcoder.github.io/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Meet your developer ↗
            </a>
          </p>
        </main>
        <footer className="login-footer">
          <span>© {new Date().getFullYear()} J0hnvexcoder</span>
          <nav className="login-legal-links" aria-label="Portal policies">
            <a href="/privacy">Privacy</a>
            <a href="/terms">Terms</a>
          </nav>
        </footer>
      </section>
      <StudioScene />
    </div>
  );
}
