import {
  AdminSummary,
  HelpPanel,
  PackageVersionForm,
} from "./components/OperationsPanels";
import { defaultSettings, type Settings } from "./features/admin-settings";
import { ProjectPanels } from "./components/ProjectPanels";
import { ContentField } from "./components/ContentField";
import {
  activeFields,
  routePaths,
} from "./features/questionnaire/content-model";
import {
  RotateCredential,
  SettingsPanel,
  RecoveryPanel,
  AuditPanel,
} from "./components/AccountPanels";
import { Login } from "./components/Login";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Copy,
  FileText,
  FolderOpen,
  Grid2X2,
  Layers3,
  LifeBuoy,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import QRCode from "react-qr-code";
import { api } from "./lib/api";
import {
  saveBeforeLeaving,
  SAVE_BEFORE_LEAVE,
  type PendingSave,
} from "./lib/pending";
import { IDLE_EXPIRY_MS, IDLE_WARNING_MS } from "./lib/security";
import { type PackageConfig } from "./features/packages/catalog";
import {
  type SectionDefinition,
  type FieldAnswer,
  completion,
} from "./features/questionnaire/schema";
interface User {
  mustRotate: boolean;
  id: string;
  email: string;
  role: string;
  companyId: string | null;
  twoFactorEnabled: boolean;
  lastActivityAt: number;
}
interface Project {
  id: string;
  title: string;
  type: string;
  status: string;
  companyName: string;
  companyEmail: string;
  updatedAt: string;
}
interface PackageVersion {
  id: string;
  version: number;
  config: PackageConfig;
}
interface Detail {
  project: Project;
  config: PackageConfig;
  sections: SectionDefinition[];
  drafts: {
    section: string;
    answers: Record<string, FieldAnswer>;
    revision: number;
  }[];
  completion: number;
  control?: { baselineVersion: number; editableSections: string[] | null };
}
const money = (n: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(n);
function Brand() {
  return (
    <div className="brand">
      <img
        className="portfolio-brand-icon"
        src="/icon.svg"
        alt="J0hnvexcoder"
        width="40"
        height="40"
      />
      <div>
        <strong>
          J0hnvexcoder<span className="brand-dot">.</span>
        </strong>
        <small>CLIENT WORKSPACE</small>
      </div>
    </div>
  );
}
function Busy() {
  return (
    <div className="loading" role="status">
      <Loader2 className="spin" size={22} /> Opening your workspace…
    </div>
  );
}
export function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [warning, setWarning] = useState(false),
    [sessionNotice, setSessionNotice] = useState("");
  const lastActivity = useRef(0),
    lastSent = useRef(0);
  const refresh = useCallback(async () => {
    try {
      const data = await api<{ user: User }>("/api/me");
      setUser(data.user);
      lastActivity.current = data.user.lastActivityAt;
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void api<{ user: User }>("/api/me")
      .then((data) => {
        if (alive) {
          lastActivity.current = data.user.lastActivityAt;
          setUser(data.user);
        }
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  const signOut = useCallback(async (message = "") => {
    if (!message && !(await saveBeforeLeaving())) return;
    try {
      await api("/api/auth/sign-out", { method: "POST", body: "{}" });
    } catch {
      if (!message) {
        setSessionNotice(
          "Sign-out could not reach the server. Keep this tab open and retry.",
        );
        return;
      }
    }
    setUser(null);
    setSessionNotice(message);
    setWarning(false);
  }, []);
  useEffect(() => {
    if (!user) return;
    let inFlight = false;
    let warned = false;
    const active = () => {
      const now = Date.now();
      if (now - lastActivity.current >= IDLE_EXPIRY_MS) {
        void signOut("Your session ended after 10 minutes of inactivity.");
        return;
      }
      lastActivity.current = now;
      warned = false;
      setWarning(false);
      if (now - lastSent.current > 30_000 && !inFlight) {
        inFlight = true;
        lastSent.current = now;
        void api("/api/activity", { method: "POST", body: "{}" })
          .catch((e: Error & { status?: number }) => {
            if (e.status === 401) void signOut(e.message);
          })
          .finally(() => {
            inFlight = false;
          });
      }
    };
    const timer = window.setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_EXPIRY_MS)
        void signOut("Your session ended after 10 minutes of inactivity.");
      else if (idle >= IDLE_WARNING_MS && !warned) {
        warned = true;
        setWarning(true);
        void saveBeforeLeaving();
      }
    }, 1000);
    const events = ["pointerdown", "keydown", "input"] as const;
    events.forEach((e) => window.addEventListener(e, active));
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, active));
    };
  }, [user, signOut]);
  if (!ready) return <Busy />;
  return (
    <>
      {user?.mustRotate ? (
        <RotateCredential onComplete={refresh} signOut={() => void signOut()} />
      ) : user ? (
        <Workspace
          user={user}
          refreshUser={refresh}
          signOut={() => void signOut()}
        />
      ) : (
        <Login notice={sessionNotice} onSuccess={refresh} brand={<Brand />} />
      )}{" "}
      {user && sessionNotice && (
        <div className="idle-warning" role="alert">
          {sessionNotice}
        </div>
      )}
      {warning && (
        <div className="idle-warning" role="alert">
          <LockKeyhole size={20} /> Your session will end soon. Continue editing
          to stay signed in.
        </div>
      )}
    </>
  );
}
function Workspace({
  user,
  refreshUser,
  signOut,
}: {
  user: User;
  refreshUser: () => Promise<void>;
  signOut: () => void;
}) {
  const [screen, setScreen] = useState("overview"),
    [projects, setProjects] = useState<Project[]>([]),
    [nextOffset, setNextOffset] = useState<number | null>(null),
    [packages, setPackages] = useState<PackageVersion[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [statusFilter, setStatusFilter] = useState(""),
    [packageFilter, setPackageFilter] = useState("");
  const isAdmin = user.role === "admin";
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{
        projects: Project[];
        nextOffset: number | null;
      }>("/api/projects");
      setProjects(result.projects);
      setNextOffset(result.nextOffset);
      if (isAdmin) {
        const p = await api<{ packages: PackageVersion[] }>("/api/packages");
        setPackages(p.packages);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);
  useEffect(() => {
    if (isAdmin && !user.twoFactorEnabled) return;
    let alive = true;
    void Promise.all([
      api<{ projects: Project[]; nextOffset: number | null }>("/api/projects"),
      isAdmin
        ? api<{ packages: PackageVersion[] }>("/api/packages")
        : Promise.resolve({ packages: [] }),
    ])
      .then(([result, p]) => {
        if (alive) {
          setProjects(result.projects);
          setNextOffset(result.nextOffset);
          setPackages(p.packages);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isAdmin, user.twoFactorEnabled]);
  const listQuery = new URLSearchParams({
    q: query,
    status: statusFilter,
    package: packageFilter,
  }).toString();
  useEffect(() => {
    if (isAdmin && !user.twoFactorEnabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api<{ projects: Project[]; nextOffset: number | null }>(
        "/api/projects?" + listQuery,
        { signal: controller.signal },
      )
        .then((result) => {
          setProjects(result.projects);
          setNextOffset(result.nextOffset);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [listQuery, isAdmin, user.twoFactorEnabled]);
  const nav = [
    { id: "overview", label: "Overview", icon: Grid2X2 },
    {
      id: "projects",
      label: isAdmin ? "Client projects" : "My projects",
      icon: FolderOpen,
    },
    ...(isAdmin
      ? [{ id: "packages", label: "Package library", icon: Layers3 }]
      : []),
    ...(isAdmin
      ? [
          { id: "settings", label: "Admin settings", icon: Layers3 },
          { id: "recovery", label: "Access & recovery", icon: ShieldCheck },
          { id: "audit", label: "Audit trail", icon: ClipboardList },
        ]
      : []),
    { id: "guide", label: "Workspace guide", icon: LifeBuoy },
  ];
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Brand />
        <div className="workspace-tag">
          <span className="avatar">{isAdmin ? "J" : "C"}</span>
          <div>
            <strong>{isAdmin ? "John’s studio" : "Client workspace"}</strong>
            <small>
              {isAdmin ? "OWNER WORKSPACE" : "YOUR WEBSITE, TAKING SHAPE"}
            </small>
          </div>
        </div>
        <p className="nav-heading">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              className={
                screen === n.id && !selected ? "nav-item active" : "nav-item"
              }
              onClick={async () => {
                if (!(await saveBeforeLeaving())) return;
                setScreen(n.id);
                setSelected(null);
              }}
            >
              <n.icon size={19} />
              {n.label}
              {n.id === "projects" && (
                <span className="nav-count">
                  {projects.length}
                  {nextOffset !== null ? "+" : ""}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="studio-note">
            <span className="tiny-line" />
            <strong>
              Great things,
              <br />
              one detail at a time.
            </strong>
            <p>A clear path from your first idea to the final brief.</p>
          </div>
          <button className="nav-item" onClick={signOut}>
            <LogOut size={18} />
            Sign out
          </button>
          <div className="sidebar-version">
            <i /> LOCAL BUILD <span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {selected
                ? "Project requirements"
                : nav.find((n) => n.id === screen)?.label}
            </strong>
          </div>
          <span className="topbar-right">
            <span className="privacy">
              <ShieldCheck size={15} />
              Private workspace
            </span>
            <span className="user-badge">{isAdmin ? "J" : "C"}</span>
          </span>
        </header>
        <main id="main" className="content">
          {isAdmin && !user.twoFactorEnabled ? (
            <MfaSetup onComplete={refreshUser} />
          ) : selected ? (
            <ProjectPanels
              key={selected}
              id={selected}
              admin={isAdmin}
              requirements={
                <Questionnaire
                  id={selected}
                  admin={isAdmin}
                  onBack={() => {
                    setSelected(null);
                    void load();
                  }}
                />
              }
            />
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {isAdmin
                      ? "THE STUDIO, AT A GLANCE"
                      : "LET’S MAKE SOMETHING YOURS"}
                  </span>
                  <h1>
                    {screen === "overview"
                      ? isAdmin
                        ? "A little clarity. A lot of possibility."
                        : "Your website starts here."
                      : screen === "projects"
                        ? "Room for your next great project."
                        : screen === "packages"
                          ? "A clear scope for every project."
                          : "A thoughtful start, step by step."}
                  </h1>
                  <p className="muted">
                    {screen === "overview"
                      ? "Your projects, decisions, and next steps — together in one place."
                      : screen === "packages"
                        ? "Versioned package definitions. Prices are proposal references."
                        : screen === "guide"
                          ? "Know what to share, what happens next, and where things stand."
                          : "Open a project to see its scope and work on the details."}
                  </p>
                </div>
                {isAdmin && ["overview", "projects"].includes(screen) && (
                  <button
                    className="primary"
                    onClick={() => setCreating(true)}
                    disabled={loading || !!error}
                  >
                    <Plus size={18} />
                    New client
                  </button>
                )}
              </div>
              {screen === "settings" ? (
                <SettingsPanel />
              ) : screen === "recovery" ? (
                <RecoveryPanel />
              ) : screen === "audit" ? (
                <AuditPanel />
              ) : error ? (
                <div className="error-panel" role="alert">
                  <p>{error}</p>
                  <button className="secondary" onClick={() => void load()}>
                    Try again
                  </button>
                </div>
              ) : loading ? (
                <Busy />
              ) : screen === "packages" ? (
                <div className="package-grid">
                  {packages
                    .filter(
                      (p) =>
                        !packages.some(
                          (other) =>
                            other.config.id === p.config.id &&
                            other.version > p.version,
                        ),
                    )
                    .map((p) => (
                      <article className="package-card" key={p.id}>
                        <div className="row-between">
                          <span className="eyebrow">{p.config.category}</span>
                          <span className="pill">v{p.version}</span>
                        </div>
                        <h2>{p.config.name}</h2>
                        <strong className="price">
                          {money(p.config.pricePhp)}
                        </strong>
                        <p className="muted">
                          {p.config.priceNote ?? "One-time proposal reference"}
                        </p>
                        <ul>
                          {p.config.maxPages !== null && (
                            <li>Up to {p.config.maxPages} website pages</li>
                          )}
                          {p.config.maxProjects !== undefined && (
                            <li>
                              Up to {p.config.maxProjects}{" "}
                              {p.config.id === "signature-interface"
                                ? "featured case studies"
                                : "projects"}
                            </li>
                          )}
                          {p.config.inquiry && (
                            <li>Ordinary inquiry form requirements</li>
                          )}
                          {p.config.reservation && (
                            <li>Manually confirmed reservation requests</li>
                          )}
                          {p.config.seats && (
                            <li>
                              {p.config.seats} delivered-site CMS admin seats
                            </li>
                          )}
                          {p.config.category === "cms" && (
                            <li>
                              Editable-section cap:{" "}
                              {p.config.editableSections ??
                                "owner setup required"}
                            </li>
                          )}
                          {p.config.id === "bookingsuite" && (
                            <li>
                              Written manual scope required before booking
                              unlocks
                            </li>
                          )}
                          {p.config.priorityUrls && (
                            <li>Up to {p.config.priorityUrls} priority URLs</li>
                          )}
                          {p.config.careMonths && (
                            <li>Care starts at recorded website launch</li>
                          )}
                        </ul>
                        <PackageVersionForm
                          item={p}
                          onSaved={() => void load()}
                        />
                      </article>
                    ))}
                </div>
              ) : screen === "guide" ? (
                <>
                  <Guide />
                  <HelpPanel />
                </>
              ) : (
                <>
                  {screen === "overview" && (
                    <>
                      {isAdmin && <AdminSummary />}
                      <section
                        className="stats-grid"
                        aria-label="Project summaries"
                      >
                        <Stat
                          label="Projects in this view"
                          value={
                            String(projects.length) +
                            (nextOffset !== null ? "+" : "")
                          }
                          note="25 projects per page"
                          icon={FolderOpen}
                        />
                        <Stat
                          label="Collecting the details"
                          value={String(
                            projects.filter((p) => p.status === "draft").length,
                          )}
                          note="Draft requirements"
                          icon={ClipboardList}
                        />
                        <Stat
                          label="Ready for review"
                          value={String(
                            projects.filter(
                              (p) => p.status === "pending_approval",
                            ).length,
                          )}
                          note="Awaiting verified approval"
                          icon={FileText}
                        />
                      </section>
                      <section className="welcome-panel">
                        <div className="welcome-copy">
                          <span className="eyebrow">A STRONG START</span>
                          <h2>
                            Good work starts
                            <br />
                            with a clear brief<span>.</span>
                          </h2>
                          <p>
                            Bring the right content, ideas, and decisions
                            together. We’ll take the next step from there.
                          </p>
                          <button
                            className="text-button"
                            onClick={() => setScreen("guide")}
                          >
                            Explore the process <ArrowRight size={16} />
                          </button>
                        </div>
                        <div className="process-cards">
                          <div>
                            <span>01</span>
                            <p>Share your vision</p>
                            <small>The story behind your website</small>
                            <Check size={17} />
                          </div>
                          <div>
                            <span>02</span>
                            <p>Shape the details</p>
                            <small>Content, assets & a clear scope</small>
                            <ArrowUpRight size={17} />
                          </div>
                          <div>
                            <span>03</span>
                            <p>Build with clarity</p>
                            <small>A shared reference for what’s next</small>
                            <ArrowUpRight size={17} />
                          </div>
                        </div>
                      </section>
                    </>
                  )}
                  <section className="project-section">
                    <div className="section-heading">
                      <div>
                        <h2>
                          {isAdmin ? "Client projects" : "Your projects"}
                          <span className="subtle-count">
                            {projects.length}
                          </span>
                        </h2>
                        <p className="muted">
                          {isAdmin
                            ? "The people and ideas you’re bringing to life."
                            : "Pick up where you left off."}
                        </p>
                      </div>
                      <label className="search">
                        <Search size={17} />
                        <span className="sr-only">Search projects</span>
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Search clients and projects…"
                        />
                      </label>
                    </div>
                    <div className="item-actions">
                      <label>
                        Project status
                        <select
                          value={statusFilter}
                          onChange={(e) => setStatusFilter(e.target.value)}
                        >
                          <option value="">All statuses</option>
                          {[
                            "draft",
                            "pending_approval",
                            "approved",
                            "archived",
                          ].map((v) => (
                            <option key={v} value={v}>
                              {v.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      {isAdmin && (
                        <label>
                          Assigned package
                          <select
                            value={packageFilter}
                            onChange={(e) => setPackageFilter(e.target.value)}
                          >
                            <option value="">All packages</option>
                            {packages
                              .filter(
                                (p) =>
                                  !packages.some(
                                    (other) =>
                                      other.config.id === p.config.id &&
                                      other.version > p.version,
                                  ),
                              )
                              .map((p) => (
                                <option key={p.config.id} value={p.config.id}>
                                  {p.config.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                    </div>
                    {projects.length === 0 ? (
                      <div className="empty-state">
                        <div className="empty-icon">
                          <FolderOpen size={29} />
                        </div>
                        <h3>
                          {isAdmin
                            ? query || statusFilter || packageFilter
                              ? "No matching projects."
                              : "Your first project starts here."
                            : "Your workspace is ready."}
                        </h3>
                        <p>
                          {isAdmin
                            ? "Create a test company, select its package, and give its ideas a place to take shape."
                            : "John will assign your project. It will appear here when it is ready."}
                        </p>
                        {isAdmin && (
                          <button
                            className="secondary"
                            onClick={() => setCreating(true)}
                          >
                            <Plus size={17} />
                            Create your first client
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="project-list">
                        {projects
                          .filter((p) =>
                            `${p.companyName} ${p.title} ${p.status}`
                              .toLowerCase()
                              .includes(query.toLowerCase()),
                          )
                          .map((p) => (
                            <button
                              className="project-row"
                              key={p.id}
                              onClick={() => setSelected(p.id)}
                            >
                              <span className="project-initial">
                                {p.companyName.slice(0, 1).toUpperCase()}
                              </span>
                              <span className="project-name">
                                <strong>{p.companyName}</strong>
                                <small>{p.title}</small>
                              </span>
                              <span className="project-kind">{p.type}</span>
                              <span className="status-dot">
                                <i />
                                {p.status.replace("_", " ")}
                              </span>
                              <ArrowUpRight size={18} />
                            </button>
                          ))}
                      </div>
                    )}
                    {nextOffset !== null && (
                      <button
                        className="secondary load-more"
                        onClick={async () => {
                          try {
                            const next = await api<{
                              projects: Project[];
                              nextOffset: number | null;
                            }>(
                              `/api/projects?${listQuery}&offset=${nextOffset}`,
                            );
                            setProjects((p) => [...p, ...next.projects]);
                            setNextOffset(next.nextOffset);
                          } catch (e) {
                            setError((e as Error).message);
                          }
                        }}
                      >
                        Load more projects
                      </button>
                    )}
                  </section>
                  <div className="workspace-footnote">
                    <ShieldCheck size={16} />
                    <span>
                      Synthetic data only in this local build. Signoff requires
                      completed owner setup.
                    </span>
                    <span>BUILT WITH INTENTION.</span>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>
      {creating && (
        <NewClient
          packages={packages.filter(
            (p) =>
              !packages.some(
                (other) =>
                  other.config.id === p.config.id && other.version > p.version,
              ),
          )}
          onClose={() => setCreating(false)}
          onCreated={() => void load()}
        />
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof FolderOpen;
}) {
  return (
    <article className="stat">
      <div className="row-between">
        <span>{label}</span>
        <Icon size={19} />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
function Guide() {
  return (
    <div className="guide-grid">
      {[
        {
          n: "01",
          title: "Tell your story",
          text: "Start with your company or profile, your audience, and what you want your website to achieve. Answer only what you know.",
        },
        {
          n: "02",
          title: "Bring the details together",
          text: "Your assigned package controls what you see. Share original media with HTTPS links. The portal does not upload your assets or send visitor inquiries.",
        },
        {
          n: "03",
          title: "Save as you go",
          text: "Pause typing and your answers save to the server. “Not sure yet” flags a decision for later; it does not count as complete. Keep your text if another session saves first.",
        },
        {
          n: "04",
          title: "Review before building",
          text: "The questionnaire is a content reference, not the final visual design. Review & versions records verified approval after owner setup. Questions & requests handles discussion and changes. PDF export still requires release validation.",
        },
      ].map((s) => (
        <article className="guide-card" key={s.n}>
          <span className="eyebrow">STEP {s.n}</span>
          <h2>{s.title}</h2>
          <p className="muted">{s.text}</p>
        </article>
      ))}
    </div>
  );
}
function MfaSetup({ onComplete }: { onComplete: () => Promise<void> }) {
  const [setup, setSetup] = useState<{
      totpURI: string;
      backupCodes: string[];
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (!setup) {
        setSetup(
          await api("/api/auth/two-factor/enable", {
            method: "POST",
            body: JSON.stringify({ password: data.get("password") }),
          }),
        );
      } else {
        await api("/api/auth/two-factor/verify-totp", {
          method: "POST",
          body: JSON.stringify({ code: data.get("code"), trustDevice: false }),
        });
        await onComplete();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mfa-card">
      <span className="security-icon">
        <ShieldCheck size={28} />
      </span>
      <span className="eyebrow">PROTECT YOUR STUDIO</span>
      <h1>
        One more step before
        <br />
        the first project.
      </h1>
      <p className="muted">
        Set up your authenticator app. Administrator actions stay locked until a
        code is verified.
      </p>
      <form onSubmit={submit}>
        {setup ? (
          <>
            <div className="qr">
              <QRCode value={setup.totpURI} size={170} />
            </div>
            <details>
              <summary>Manual setup key</summary>
              <code className="secret-text">
                {new URL(setup.totpURI).searchParams.get("secret")}
              </code>
            </details>
            <details>
              <summary>Save your recovery codes privately</summary>
              <p>
                These codes grant account access. Store them securely before
                continuing.
              </p>
              <code className="secret-text">
                {setup.backupCodes.join("\n")}
              </code>
            </details>
            <label>
              Authenticator code
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoComplete="one-time-code"
              />
            </label>
          </>
        ) : (
          <label>
            Confirm your owner password
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy
            ? "Please wait…"
            : setup
              ? "Verify & open workspace"
              : "Set up authenticator"}
          <ArrowRight size={17} />
        </button>
      </form>
    </section>
  );
}
function NewClient({
  packages,
  onClose,
  onCreated,
}: {
  packages: PackageVersion[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [chosen, setChosen] = useState(
      packages.find((p) => p.config.id === "webcore")?.id ?? "",
    ),
    [cms, setCms] = useState(""),
    [seo, setSeo] = useState(""),
    [care, setCare] = useState(""),
    [created, setCreated] = useState<{
      email: string;
      companyName: string;
      credential: string;
    } | null>(null),
    [revealed, setRevealed] = useState(false),
    [copied, setCopied] = useState(false),
    [welcome, setWelcome] = useState(defaultSettings.welcomeTemplate);
  const dialog = useRef<HTMLDialogElement>(null),
    priorFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    void api<{ value: Settings }>("/api/admin/settings")
      .then((v) => setWelcome(v.value.welcomeTemplate))
      .catch(() => {});
    priorFocus.current = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      priorFocus.current?.focus();
    };
  }, []);
  const selected = packages.find((p) => p.id === chosen),
    cmsPackage = packages.find((p) => p.id === cms);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const value = await api<{
        email: string;
        companyName: string;
        credential: string;
      }>("/api/admin/companies", {
        method: "POST",
        body: JSON.stringify({
          companyName: data.get("companyName"),
          recoverInterruptedSetup:
            data.get("recoverInterruptedSetup") === "yes",
          email: data.get("email"),
          projectTitle: data.get("projectTitle"),
          packageVersionId: chosen,
          ...(cms ? { cmsVersionId: cms } : {}),
          ...(seo ? { seoVersionId: seo } : {}),
          ...(care ? { careVersionId: care } : {}),
          scopeReference: data.get("scopeReference"),
        }),
      });
      setCreated(value);
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="new-client-title"
    >
      <div className="modal-header">
        <span className="eyebrow">A NEW BEGINNING</span>
        <button
          className="icon-button"
          aria-label="Close new client"
          disabled={busy}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {created ? (
        <>
          <h2 id="new-client-title">Their workspace is ready.</h2>
          <p className="muted">
            The credential is available only in this window. Copy it before
            closing and share it separately through your agreed channel.
          </p>
          <div className="credential-box">
            <span>{created.email}</span>
            {revealed ? (
              <code>{created.credential}</code>
            ) : (
              <button className="secondary" onClick={() => setRevealed(true)}>
                Reveal credential
              </button>
            )}
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created.credential);
                  setCopied(true);
                } catch {
                  setError("Clipboard unavailable. Reveal and copy manually.");
                }
              }}
            >
              <Copy size={16} />
              {copied ? "Copied" : "Copy credential"}
            </button>
          </div>
          <a
            className="primary"
            href={`mailto:${encodeURIComponent(created.email)}?subject=${encodeURIComponent("Your website planning workspace")}&body=${encodeURIComponent(welcome.replaceAll("{{company}}", created.companyName).replaceAll("{{portalUrl}}", window.location.origin).replaceAll("{{email}}", created.email))}`}
          >
            <Mail size={17} />
            Open welcome draft
          </a>
          <p className="muted small">
            Opening a draft does not send an email. It contains no credential.
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="text-button" onClick={onClose}>
            Done <Check size={17} />
          </button>
        </>
      ) : (
        <>
          <h2 id="new-client-title">Give a new idea its space.</h2>
          <p className="muted">
            Create a synthetic company and its first project. No email will be
            sent.
          </p>
          <form onSubmit={submit}>
            <label>
              Company name
              <input
                name="companyName"
                placeholder="DEMO — Northstar Studio"
                minLength={2}
                maxLength={120}
                required
              />
            </label>
            <label>
              Company email
              <input
                name="email"
                aria-label="Company email"
                type="email"
                placeholder="team@northstar.test"
                required
              />
              <small>Use a synthetic .test address in this local build.</small>
            </label>
            <label className="inline-check">
              <input
                name="recoverInterruptedSetup"
                type="checkbox"
                value="yes"
              />
              Recover an interrupted setup for this email, if it has no company
              and is over one hour old.
            </label>
            <label>
              Project title
              <input
                name="projectTitle"
                placeholder="A new website for Northstar"
                minLength={2}
                maxLength={120}
                required
              />
            </label>
            <label>
              Website or portfolio package
              <select
                value={chosen}
                onChange={(e) => setChosen(e.target.value)}
                required
              >
                {packages
                  .filter((p) =>
                    ["website", "portfolio"].includes(p.config.category),
                  )
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.config.name} · v{p.version}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Optional CMS package
              <select value={cms} onChange={(e) => setCms(e.target.value)}>
                <option value="">No CMS package</option>
                {packages
                  .filter((p) => p.config.category === "cms")
                  .map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.config.name} · v{p.version}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Optional SEO service
              <select value={seo} onChange={(e) => setSeo(e.target.value)}>
                <option value="">None</option>
                {packages
                  .filter((p) => p.config.category === "seo")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.config.name} · v{p.version}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Optional care service
              <select value={care} onChange={(e) => setCare(e.target.value)}>
                <option value="">None</option>
                {packages
                  .filter((p) => p.config.category === "care")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.config.name} · v{p.version}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Scope document reference
              <input
                name="scopeReference"
                placeholder="Document title or agreed reference"
                maxLength={1000}
              />
            </label>
            <div className="scope-note">
              <span>Proposal reference only</span>
              <strong>
                {money(
                  (selected?.config.pricePhp ?? 0) +
                    (cmsPackage?.config.pricePhp ?? 0) +
                    (packages.find((p) => p.id === seo)?.config.pricePhp ?? 0) +
                    (packages.find((p) => p.id === care)?.config.pricePhp ?? 0),
                )}
              </strong>
              <small>
                {selected?.config.maxPages
                  ? `Up to ${selected.config.maxPages} website pages. `
                  : ""}
                {selected?.config.id === "bookingsuite"
                  ? "Booking remains locked pending approved manual scope. "
                  : ""}
                {cms
                  ? "CMS editable-section cap needs an owner decision. "
                  : ""}
                No payment is created.
              </small>
            </div>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? (
                <Loader2 className="spin" size={18} />
              ) : (
                <Plus size={18} />
              )}{" "}
              {busy ? "Creating workspace…" : "Create client workspace"}
            </button>
          </form>
        </>
      )}
    </dialog>
  );
}
function Questionnaire({
  id,
  admin,
  onBack,
}: {
  id: string;
  admin: boolean;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null),
    [sectionId, setSectionId] = useState(""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<Record<string, Record<string, FieldAnswer>>>(
      {},
    ),
    [, setRevisions] = useState<Record<string, number>>({}),
    [fields, setFields] = useState<Record<string, FieldAnswer>>({}),
    [saveStatus, setSaveStatus] = useState("All changes saved"),
    [conflict, setConflict] = useState(false),
    [pending, setPending] = useState(false),
    [saving, setSaving] = useState(false),
    [displayName, setDisplayName] = useState(""),
    [anotherEditor, setAnotherEditor] = useState(false);
  const lastEdit = useRef(0);
  const dirty = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    latest = useRef(fields),
    revisionRef = useRef<Record<string, number>>({}),
    busy = useRef(false),
    waiters = useRef<(() => void)[]>([]),
    sectionRef = useRef(sectionId);
  useEffect(() => {
    let alive = true;
    void api<Detail>(`/api/projects/${id}`)
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        const answers = Object.fromEntries(
            d.drafts.map((v) => [v.section, v.answers]),
          ),
          rev = Object.fromEntries(
            d.drafts.map((v) => [v.section, v.revision]),
          );
        setSaved(answers);
        setRevisions(rev);
        revisionRef.current = rev;
        const first = d.sections[0]?.id ?? "";
        setSectionId(first);
        sectionRef.current = first;
        setFields(answers[first] ?? {});
        latest.current = answers[first] ?? {};
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, [id]);
  const save = useCallback(async () => {
    while (busy.current)
      await new Promise<void>((resolve) => waiters.current.push(resolve));
    if (!dirty.current || conflict) return;
    busy.current = true;
    setSaving(true);
    setSaveStatus("Saving…");
    const target = sectionRef.current;
    const snapshot = latest.current;
    try {
      const result = await api<{ revision: number }>(
        `/api/projects/${id}/sections/${target}`,
        {
          method: "PUT",
          body: JSON.stringify({
            revision: revisionRef.current[target] ?? 0,
            fields: snapshot,
          }),
        },
      );
      revisionRef.current = {
        ...revisionRef.current,
        [target]: result.revision,
      };
      setRevisions(revisionRef.current);
      setSaved((s) => ({ ...s, [target]: snapshot }));
      if (latest.current === snapshot) {
        dirty.current = false;
        setPending(false);
        setSaveStatus("All changes saved");
      } else setSaveStatus("Changes waiting to save");
      setError("");
    } catch (e) {
      setSaveStatus("Couldn’t save");
      setError((e as Error).message);
      if ((e as Error & { status?: number }).status === 409) setConflict(true);
    } finally {
      busy.current = false;
      waiters.current.splice(0).forEach((resolve) => resolve());
      setSaving(false);
      if (latest.current !== snapshot) setFields({ ...latest.current });
    }
  }, [id, conflict]);
  useEffect(() => {
    if (pending && !conflict) {
      timer.current = setTimeout(() => void save(), 800);
      return () => {
        if (timer.current) clearTimeout(timer.current);
      };
    }
  }, [fields, pending, conflict, save]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, []);
  useEffect(() => {
    const flush = (event: Event) => {
      const detail = (event as CustomEvent<PendingSave>).detail;
      detail.tasks.push(save().then(() => !dirty.current));
    };
    window.addEventListener(SAVE_BEFORE_LEAVE, flush);
    return () => window.removeEventListener(SAVE_BEFORE_LEAVE, flush);
  }, [save]);
  useEffect(() => {
    if (!sectionId) return;
    let alive = true;
    lastEdit.current = Date.now();
    const path = `/api/projects/${id}/sections/${sectionId}/lease`;
    const release = () => {
      void api(path, { method: "DELETE", keepalive: true }).catch(() => {});
    };
    const acquire = () => {
      if (document.hidden || Date.now() - lastEdit.current > 45000) return;
      void api<{ anotherEditor: boolean }>(path, { method: "POST", body: "{}" })
        .then((v) => {
          if (alive) setAnotherEditor(v.anotherEditor);
        })
        .catch(() => {});
    };
    acquire();
    const heartbeat = window.setInterval(acquire, 30000);
    const visibility = () => {
      if (document.hidden) release();
      else acquire();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false;
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", visibility);
      release();
    };
  }, [id, sectionId]);
  const change = useCallback((key: string, value: FieldAnswer) => {
    lastEdit.current = Date.now();
    const next = { ...latest.current, [key]: value };
    latest.current = next;
    setFields(next);
    dirty.current = true;
    setPending(true);
    setSaveStatus("Changes waiting to save");
  }, []);
  async function navigate(next: string) {
    if (next === sectionRef.current) return;
    if (dirty.current) {
      await save();
      if (dirty.current) return;
    }
    setSectionId(next);
    sectionRef.current = next;
    const target = saved[next] ?? {};
    latest.current = target;
    setFields(target);
    setConflict(false);
    setError("");
  }
  async function back() {
    if (dirty.current) {
      await save();
      if (dirty.current) return;
    }
    onBack();
  }
  if (!detail)
    return error ? (
      <div className="error-panel" role="alert">
        <p>{error}</p>
        <button className="secondary" onClick={onBack}>
          Back to projects
        </button>
      </div>
    ) : (
      <Busy />
    );
  const section = detail.sections.find((s) => s.id === sectionId)!;
  const canEdit =
    detail.project.status === "draft" &&
    (!detail.control?.baselineVersion ||
      !detail.control.editableSections ||
      detail.control.editableSections.includes(sectionId));
  const percent = completion(detail.sections, {
    ...saved,
    [sectionId]: fields,
  });
  return (
    <>
      <button className="text-button back-link" onClick={() => void back()}>
        ← All projects
      </button>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {detail.config.name.toUpperCase()} · CONTENT REFERENCE
          </span>
          <h1>{detail.project.title}</h1>
          <p className="muted">
            Small steps. A clearer picture of your future website.
          </p>
        </div>
        <span className="save-status" role="status">
          {saving ? (
            <Loader2 className="spin" size={16} />
          ) : pending ? (
            <FileText size={16} />
          ) : (
            <CheckCircle2 size={16} />
          )}{" "}
          {saveStatus}
        </span>
      </div>
      <div className="reference-banner">
        <Sparkles size={19} />
        <p>
          This questionnaire is a content reference,{" "}
          <strong>not your final website design.</strong> Share what you know;
          mark the rest “Not sure yet.”
        </p>
      </div>
      {!admin && (
        <label className="display-name">
          Who’s editing today?
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your first name"
            maxLength={80}
          />
          <small>Used only in this open view. Your name is not saved.</small>
        </label>
      )}
      <div className="questionnaire-layout">
        <aside className="question-nav">
          <div className="progress-label">
            <strong>Your progress</strong>
            <span>{percent}%</span>
          </div>
          <p className="route-counter">
            {(() => {
              try {
                return routePaths({ ...saved, [sectionId]: fields }).length;
              } catch {
                return "Check page paths";
              }
            })()}{" "}
            / {detail.config.maxPages ?? "scope review"} pages
          </p>
          <div className="progress-track">
            <i style={{ width: `${percent}%` }} />
          </div>
          <nav aria-label="Questionnaire sections">
            {detail.sections.map((s, index) => (
              <button
                key={s.id}
                className={
                  sectionId === s.id ? "question-step active" : "question-step"
                }
                onClick={() => void navigate(s.id)}
                disabled={saving}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {s.title}
                <ChevronRight size={14} />
              </button>
            ))}
          </nav>
          <p className="small muted">
            Use Review & versions to review your brief and approved records.
          </p>
        </aside>
        <section className="question-card">
          <div className="row-between">
            <span className="eyebrow">
              SECTION{" "}
              {String(detail.sections.indexOf(section) + 1).padStart(2, "0")}
            </span>
            <span className="pill">{detail.config.name}</span>
          </div>
          <h2>{section.title}</h2>
          <p className="muted">{section.description}</p>
          <button
            className="text-button"
            onClick={async () => {
              if (await saveBeforeLeaving())
                window.dispatchEvent(
                  new CustomEvent("portal:ask", { detail: section.id }),
                );
            }}
          >
            Ask John about this section
          </button>
          {anotherEditor && (
            <p className="warning-panel" role="status">
              Another session is editing this section. Save checks will prevent
              overwrites.
            </p>
          )}
          {!canEdit && (
            <p className="scope-note">
              This content is read-only. Approved changes reopen only the agreed
              sections.
            </p>
          )}
          <fieldset
            className="question-fields"
            disabled={!canEdit}
            style={{ border: 0, padding: 0, marginInline: 0 }}
          >
            {activeFields(section, fields).map((f) => {
              const answer = fields[f.key] ?? {
                value: "",
                status: "skipped" as const,
              };
              return (
                <div className="question-field" key={f.key}>
                  <label htmlFor={`field-${f.key}`}>
                    {f.label}
                    {f.required && (
                      <span className="required">Required for review</span>
                    )}
                  </label>
                  <p className="field-help" id={`help-${f.key}`}>
                    {f.help}
                  </p>
                  <ContentField
                    field={f}
                    answer={answer}
                    config={detail.config}
                    id={`field-${f.key}`}
                    onChange={(value) =>
                      change(f.key, {
                        value,
                        status: value.trim() ? "provided" : "skipped",
                      })
                    }
                    onBlur={() => void save()}
                  />
                  <div className="answer-status">
                    <label>
                      <input
                        type="checkbox"
                        checked={answer.status === "unsure"}
                        onChange={(e) =>
                          change(f.key, {
                            ...answer,
                            status: e.target.checked
                              ? "unsure"
                              : answer.value.trim()
                                ? "provided"
                                : "skipped",
                          })
                        }
                      />
                      Not sure yet
                    </label>
                    <button
                      type="button"
                      className="text-button small"
                      onClick={() =>
                        change(f.key, {
                          ...answer,
                          status:
                            answer.status === "not_applicable"
                              ? answer.value.trim()
                                ? "provided"
                                : "skipped"
                              : "not_applicable",
                        })
                      }
                    >
                      {answer.status === "not_applicable"
                        ? "Marked not applicable · undo"
                        : "Not applicable"}
                    </button>
                    {answer.status === "unsure" && (
                      <small>
                        Flagged for discussion; does not count as complete.
                      </small>
                    )}
                  </div>
                </div>
              );
            })}
          </fieldset>
          {error && (
            <div className="error-panel" role="alert">
              <p>{error}</p>
              {conflict ? (
                <>
                  <p>
                    Your current text stays here. Copy it before loading the
                    saved version.
                  </p>
                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        const d = await api<Detail>(`/api/projects/${id}`);
                        const current = d.drafts.find(
                          (v) => v.section === sectionId,
                        );
                        revisionRef.current = {
                          ...revisionRef.current,
                          [sectionId]: current?.revision ?? 0,
                        };
                        setRevisions(revisionRef.current);
                        const next = current?.answers ?? {};
                        latest.current = next;
                        setFields(next);
                        setSaved((v) => ({ ...v, [sectionId]: next }));
                        dirty.current = false;
                        setPending(false);
                        setConflict(false);
                        setSaveStatus("Saved version loaded");
                        setError("");
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Load saved version
                  </button>
                </>
              ) : (
                <button
                  className="secondary"
                  disabled={saving}
                  onClick={() => void save()}
                >
                  Retry saving
                </button>
              )}
            </div>
          )}
          <div className="question-footer">
            <span className="muted small">
              Saved to your project, across sessions.
            </span>
            <button
              className="primary"
              disabled={saving || conflict || !canEdit}
              onClick={() => {
                const next =
                  detail.sections[detail.sections.indexOf(section) + 1];
                if (next) void navigate(next.id);
                else void save();
              }}
            >
              {detail.sections.indexOf(section) < detail.sections.length - 1
                ? "Save & continue"
                : "Save section"}
              <ArrowRight size={17} />
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
