import { CarePanel } from "./CarePanel";
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  Copy,
  Plus,
  Send,
  ShieldCheck,
} from "lucide-react";
import { api } from "../lib/api";
import { saveBeforeLeaving } from "../lib/pending";
import { definitions } from "../features/questionnaire/schema";
import type {
  FieldAnswer,
  SectionDefinition,
} from "../features/questionnaire/schema";
import {
  activeFields,
  routePaths,
  parseItems,
  type ReviewIssue,
} from "../features/questionnaire/content-model";
import type { FrozenSubmission } from "../features/exports";
import type { PackageConfig, ManualScope } from "../features/packages/catalog";
interface Control {
  revision: number;
  baselineVersion: number;
  editableSections: string[] | null;
  manualScope: ManualScope | null;
  launchAt: string | null;
  testUrl: string | null;
  approverName: string | null;
  approverEmail: string | null;
  approverMethod: string | null;
  approverVerifiedAt: string | null;
}
interface ReviewData {
  project: {
    id: string;
    companyId: string;
    title: string;
    status: string;
    scopeReference: string | null;
  };
  config: PackageConfig;
  control: Control;
  sections: SectionDefinition[];
  saved: Record<string, Record<string, FieldAnswer>>;
  issues: ReviewIssue[];
  setupGaps: string[];
  snapshots: {
    id: string;
    version: number;
    createdAt: string;
    contentHash: string;
  }[];
  agreement: { text: string; version: string };
  routes: string[];
  assigned: {
    packageVersionId: string;
    category: string;
    snapshot: PackageConfig;
  }[];
}
export function ProjectPanels({
  id,
  admin,
  requirements,
}: {
  id: string;
  admin: boolean;
  requirements: ReactNode;
}) {
  const [tab, setTab] = useState("requirements"),
    [contextSection, setContextSection] = useState("");
  useEffect(() => {
    const ask = (event: Event) => {
      const section = (event as CustomEvent<string>).detail;
      if (typeof section === "string") {
        setContextSection(section);
        setTab("inbox");
      }
    };
    window.addEventListener("portal:ask", ask);
    return () => window.removeEventListener("portal:ask", ask);
  }, []);
  return (
    <>
      <nav className="project-tabs" aria-label="Project tools">
        {[
          "requirements",
          "review",
          "inbox",
          ...(admin ? ["controls"] : []),
          "checkup",
          "care",
        ].map((key) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            onClick={async () => {
              if (await saveBeforeLeaving()) setTab(key);
            }}
          >
            {
              {
                requirements: "Requirements",
                review: "Review & versions",
                inbox: "Questions & requests",
                controls: "Owner controls",
                checkup: "Website checkup",
                care: "Website care",
              }[key]
            }
          </button>
        ))}
      </nav>
      {tab === "requirements" ? (
        requirements
      ) : tab === "review" ? (
        <ReviewPanel id={id} admin={admin} />
      ) : tab === "inbox" ? (
        <InboxPanel id={id} admin={admin} initialSection={contextSection} />
      ) : tab === "controls" ? (
        <ProjectControls id={id} />
      ) : tab === "care" ? (
        <CarePanel id={id} admin={admin} />
      ) : (
        <CheckupPanel id={id} />
      )}
    </>
  );
}
function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}
export function ContentPreview({
  sections,
  saved,
}: {
  sections: SectionDefinition[];
  saved: Record<string, Record<string, FieldAnswer>>;
}) {
  return (
    <div className="content-preview">
      {sections.map((section) => (
        <article className="preview-section" key={section.id}>
          <span className="eyebrow">CONTENT REFERENCE · {section.id}</span>
          <h2>{section.title}</h2>
          {section.id === "hero" && (
            <div className="preview-hero">
              <h3>
                {saved.hero?.headline?.status === "provided"
                  ? saved.hero.headline.value
                  : "[Headline pending]"}
              </h3>
              <p className="muted small">
                {saved.hero?.support?.value || "[Supporting content pending]"}
              </p>
              <div className="preview-placeholder">
                Media reference ·{" "}
                {saved.hero?.mode?.value?.replaceAll("_", " ") ||
                  "format pending"}
              </div>
              <small className="muted">
                Layout reference only. The finished website design will differ.
              </small>
            </div>
          )}
          <dl>
            {activeFields(section, saved[section.id] ?? {}).map((field) => {
              const answer = saved[section.id]?.[field.key];
              return (
                <div key={field.key}>
                  <dt>
                    {field.label} · {answer?.status ?? "skipped"}
                  </dt>
                  <dd>
                    {answer?.status === "provided" &&
                    field.type === "collection" ? (
                      <div className="preview-grid">
                        {parseItems(answer.value).map((item) => (
                          <article key={item.id}>
                            {field.itemFields?.map((f) =>
                              item.fields[f.key] ? (
                                <p key={f.key}>
                                  <strong>{f.label}: </strong>
                                  {item.fields[f.key]}
                                </p>
                              ) : null,
                            )}
                          </article>
                        ))}
                      </div>
                    ) : (
                      answer?.value ||
                      `[${answer?.status === "unsure" ? "Unsure — discuss with John" : answer?.status === "not_applicable" ? "Not applicable" : "Not provided"}]`
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        </article>
      ))}
    </div>
  );
}
function ReviewPanel({ id, admin }: { id: string; admin: boolean }) {
  const [data, setData] = useState<ReviewData | null>(null),
    [frozen, setFrozen] = useState<FrozenSubmission | null>(null),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState<string[]>([]),
    [challenge, setChallenge] = useState<{
      token: string;
      recipient: string;
    } | null>(null),
    [revealed, setRevealed] = useState(false);
  const load = useCallback(async () => {
    const d = await api<ReviewData>(`/api/projects/${id}/review`);
    setData(d);
  }, [id]);
  useEffect(() => {
    void api<ReviewData>(`/api/projects/${id}/review`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  async function action(path: string, body: unknown) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ message: string }>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setNotice(r.message);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function approve(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await action(`/api/projects/${id}/approve`, {
      token: form.get("token"),
      name: form.get("name"),
      email: form.get("email"),
      termsVersion: data!.agreement.version,
      agreementAccepted: form.get("agreement") === "yes",
      contentConfirmed: form.get("confirmed") === "yes",
      acceptedUnknowns: accepted,
    });
  }
  async function selectVersion(next: number) {
    setError("");
    if (next === 0) {
      setFrozen(null);
      setVersion(0);
      return;
    }
    try {
      const result = await api<{ snapshot: FrozenSubmission }>(
        `/api/projects/${id}/versions/${next}`,
      );
      setFrozen(result.snapshot);
      setVersion(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!data)
    return (
      <>
        <ErrorNotice error={error} />
        <p className="muted">Loading the project review…</p>
      </>
    );
  const issues = data.issues,
    hard = issues.filter((i) => i.kind === "missing" || i.hard),
    unknown = issues.filter((i) => i.kind === "unsure" && !i.hard);
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {data.project.status.replaceAll("_", " ")} · {data.config.name}
          </span>
          <h1>Every detail, in one place.</h1>
          <p className="muted">
            Review content and the exact scope before independently verified
            approval.
          </p>
        </div>
        <select
          aria-label="Requirements version"
          value={version}
          onChange={(e) => void selectVersion(Number(e.target.value))}
        >
          <option value={0}>Current requirements</option>
          {data.snapshots.map((v) => (
            <option key={v.id} value={v.version}>
              Approved v{v.version}
            </option>
          ))}
        </select>
      </div>
      <ErrorNotice error={error} />
      {notice && (
        <p className="success-panel" role="status">
          {notice}
        </p>
      )}
      <section className="workflow-card">
        <div className="row-between">
          <h2>
            {version
              ? `Immutable approved version ${version}`
              : "Assigned scope"}
          </h2>
          <span className="pill">
            {frozen ? routePaths(frozen.answers).length : data.routes.length}/
            {frozen
              ? ((frozen.packages as { config: PackageConfig }[]).find((p) =>
                  ["website", "portfolio"].includes(p.config.category),
                )?.config.maxPages ?? "agreed scope")
              : (data.config.maxPages ?? "manual scope")}{" "}
            pages
          </span>
        </div>
        <p className="muted small">
          {(frozen?.project.scopeReference ?? data.project.scopeReference) ||
            "Scope document reference not yet supplied."}
        </p>
        <p className="muted small">
          {(frozen
            ? (
                frozen.packages as {
                  versionId: string;
                  config: PackageConfig;
                }[]
              ).map((a) => ({
                snapshot: a.config,
                packageVersionId: a.versionId,
              }))
            : data.assigned
          )
            .map((a) => a.snapshot.name + " (" + a.packageVersionId + ")")
            .join(" · ")}
        </p>
        {!version &&
        data.config.minPages &&
        data.routes.length < data.config.minPages ? (
          <p className="scope-note">
            The proposal range begins at {data.config.minPages} pages. This
            brief currently contains {data.routes.length}; John should review
            the agreed smaller scope. No extra pages are invented.
          </p>
        ) : null}
        {data.setupGaps.length > 0 && !version && (
          <ul className="release-gaps">
            {data.setupGaps.map((v) => (
              <li key={v}>{v} — required before signoff</li>
            ))}
          </ul>
        )}
        {hard.length > 0 && !version && (
          <div className="issue-list">
            Required content:{" "}
            {hard.map((i) => i.label + " (" + i.section + ")").join("; ")}.
          </div>
        )}
        {!version && unknown.length > 0 && (
          <div className="unsure-list">
            <p className="muted small">
              Unsure answers require explicit owner acceptance, recorded in the
              approved version.
            </p>
            {unknown.map((i) => (
              <label key={i.key}>
                <input
                  type="checkbox"
                  checked={accepted.includes(i.key)}
                  onChange={(e) =>
                    setAccepted((v) =>
                      e.target.checked
                        ? [...v, i.key]
                        : v.filter((k) => k !== i.key),
                    )
                  }
                />
                {i.label} ({i.section}) — accepted as an explicit uncertainty
              </label>
            ))}
          </div>
        )}
        <div className="review-toolbar">
          {!admin && !version && data.project.status === "draft" && (
            <button
              className="primary"
              disabled={busy || hard.length > 0}
              onClick={() => void action(`/api/projects/${id}/submit`, {})}
            >
              <Send size={15} />
              Send requirements for review
            </button>
          )}
          {version > 0 && (
            <>
              <button className="secondary" onClick={() => window.print()}>
                Print approved reference
              </button>
              {admin && (
                <a
                  className="secondary"
                  href={`/api/admin/projects/${id}/versions/${version}/agent.json`}
                >
                  <ArrowDownToLine size={15} />
                  Download agent JSON
                </a>
              )}
            </>
          )}
          {admin && !version && data.project.status === "pending_approval" && (
            <button
              className="primary"
              disabled={
                busy ||
                data.setupGaps.length > 0 ||
                hard.length > 0 ||
                unknown.some((i) => !accepted.includes(i.key))
              }
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  setChallenge(
                    await api(`/api/admin/projects/${id}/approval-challenge`, {
                      method: "POST",
                      body: JSON.stringify({ acceptedUnknowns: accepted }),
                    }),
                  );
                  setRevealed(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Issue verified approval challenge
            </button>
          )}
        </div>
        {challenge && (
          <div className="credential-box">
            <strong>Deliver separately to {challenge.recipient}</strong>
            <p className="muted small">
              Expires in 15 minutes; any draft, scope or agreement change
              invalidates it.
            </p>
            {revealed ? (
              <code>{challenge.token}</code>
            ) : (
              <button className="secondary" onClick={() => setRevealed(true)}>
                Reveal one-time approval token
              </button>
            )}
            <button
              className="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(challenge.token);
                  setNotice("Approval token copied.");
                } catch {
                  setError("Clipboard unavailable. Reveal and copy manually.");
                }
              }}
            >
              <Copy size={14} />
              Copy token
            </button>
            <button className="text-button" onClick={() => setChallenge(null)}>
              Hide token
            </button>
          </div>
        )}
        {admin && data.project.status === "pending_approval" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              void action(`/api/admin/projects/${id}/return-to-draft`, {
                reason: form.get("reason"),
              });
            }}
          >
            <label>
              Return to discussion — reason
              <input name="reason" minLength={5} maxLength={2000} required />
            </label>
            <button className="secondary" disabled={busy}>
              Return draft for discussion
            </button>
          </form>
        )}
        {!admin &&
          !version &&
          data.project.status === "pending_approval" &&
          data.setupGaps.length === 0 && (
            <form onSubmit={approve}>
              <h2>Authorized approver confirmation</h2>
              <p className="muted small">
                Approval is tied to the independently verified person and
                one-time token. Possession of the shared company login alone is
                not authority.
              </p>
              <label>
                Verified approver name
                <input name="name" required maxLength={200} />
              </label>
              <label>
                Verified approver email
                <input name="email" type="email" required />
              </label>
              <label>
                One-time approval token
                <input
                  name="token"
                  autoComplete="off"
                  maxLength={48}
                  required
                />
              </label>
              <blockquote className="muted small">
                {data.agreement.text}
              </blockquote>
              <p className="muted small">
                Agreement version: {data.agreement.version}
              </p>
              <label className="inline-check">
                <input type="checkbox" name="confirmed" value="yes" required />I
                reviewed this content, media links, package scope and explicit
                uncertainties.
              </label>
              <label className="inline-check">
                <input type="checkbox" name="agreement" value="yes" required />I
                accept the displayed agreement for this requirements version.
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  hard.length > 0 ||
                  unknown.some((i) => !accepted.includes(i.key))
                }
              >
                Approve this exact version
                <ShieldCheck size={16} />
              </button>
            </form>
          )}
      </section>
      {frozen && (
        <section className="workflow-card print-reference">
          <img src="/icon.svg" alt="J0hnvexcoder" width={32} height={32} />
          <h2>
            {frozen.project.title} · Approved v{frozen.version}
          </h2>
          <p>
            {frozen.company.name} · {frozen.company.email}
          </p>
          <p>
            Approved{" "}
            {new Date(frozen.submittedAt).toLocaleString("en-PH", {
              timeZone: "Asia/Manila",
            })}{" "}
            (Asia/Manila)
          </p>
          <p>
            Authorized approver: {frozen.approver.name} ({frozen.approver.email}
            ). Company login: {frozen.approver.loginEmail}.
          </p>
          <p>
            Independent verification: {frozen.approver.verificationMethod}.
            Verified{" "}
            {new Date(frozen.approver.verifiedAt).toLocaleString("en-PH", {
              timeZone: "Asia/Manila",
            })}{" "}
            (Asia/Manila).
          </p>
          <h3>Agreed confirmation · {frozen.agreement.version}</h3>
          <p style={{ whiteSpace: "pre-wrap" }}>{frozen.agreement.text}</p>
          <p>{frozen.agreement.verificationProtocol}</p>
          {frozen.manualScope != null && (
            <pre style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(frozen.manualScope, null, 2)}
            </pre>
          )}
          <p className="small">
            Integrity hash:{" "}
            {data.snapshots.find((v) => v.version === version)?.contentHash}
          </p>
          {frozen.acceptedUnknowns.length > 0 && (
            <p>
              Explicitly accepted uncertainties:{" "}
              {frozen.acceptedUnknowns
                .map((i) => i.label + " (" + i.section + ")")
                .join("; ")}
              .
            </p>
          )}
          <p className="muted small">
            Printable reference from the immutable approved snapshot. A
            validated downloadable PDF is not yet available.
          </p>
        </section>
      )}
      <ContentPreview
        sections={frozen?.sections ?? data.sections}
        saved={frozen?.answers ?? data.saved}
      />
    </section>
  );
}
interface InboxItem {
  id: string;
  projectId: string;
  kind: string;
  visibility: string;
  subject: string;
  body: string;
  status: string;
  classification: string | null;
  size: string | null;
  quotePhp: number | null;
  affectedSections: string[] | null;
  adminReadAt: string | null;
  clientReadAt: string | null;
  baselineVersion: number;
}
function InboxPanel({
  id,
  admin,
  initialSection = "",
}: {
  id: string;
  admin: boolean;
  initialSection?: string;
}) {
  const [items, setItems] = useState<InboxItem[]>([]),
    [sections, setSections] = useState<SectionDefinition[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [kind, setKind] = useState("question"),
    [thread, setThread] = useState<{
      item: InboxItem;
      replies: {
        id: string;
        body: string;
        authorRole: string;
        createdAt: string;
      }[];
    } | null>(null);
  const reload = useCallback(async () => {
    const d = await api<{ items: InboxItem[] }>(`/api/projects/${id}/inbox`);
    setItems(d.items);
  }, [id]);
  useEffect(() => {
    void Promise.all([
      api<{ items: InboxItem[] }>(`/api/projects/${id}/inbox`),
      api<ReviewData>(`/api/projects/${id}/review`),
    ])
      .then(([a, b]) => {
        setItems(a.items);
        setSections(b.sections);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${id}/inbox`, {
        method: "POST",
        body: JSON.stringify({
          kind,
          visibility: data.get("private") === "yes" ? "private" : "shared",
          subject: data.get("subject"),
          body: data.get("body"),
          ...(data.get("section") ? { section: data.get("section") } : {}),
          ...(kind === "change"
            ? {
                classification: data.get("classification"),
                affectedSections: data.getAll("affected"),
              }
            : {}),
        }),
      });
      form.reset();
      setNotice("Saved to the project inbox. No external message was sent.");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function open(itemId: string) {
    try {
      setThread(await api(`/api/inbox/${itemId}`));
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function update(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/inbox/${thread!.item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: form.get("status"),
          size: form.get("size") || null,
          quotePhp: form.get("quote") ? Number(form.get("quote")) : null,
          shareNote: form.get("share") === "yes",
        }),
      });
      await open(thread!.item.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROJECT CONVERSATIONS</span>
          <h1>Keep the conversation connected.</h1>
          <p className="muted">
            Questions, corrections and scope changes stay with this project.
          </p>
        </div>
      </div>
      <ErrorNotice error={error} />
      {notice && (
        <p className="success-panel" role="status">
          {notice}
        </p>
      )}
      {thread ? (
        <article className="inbox-item">
          <button className="text-button" onClick={() => setThread(null)}>
            <ArrowLeft size={13} />
            All conversations
          </button>
          <div className="row-between">
            <h2>{thread.item.subject}</h2>
            <span className="pill">
              {thread.item.visibility} · {thread.item.status}
            </span>
          </div>
          <p>{thread.item.body}</p>
          {thread.item.quotePhp !== null && (
            <p>
              Quoted reference: ₱{thread.item.quotePhp.toLocaleString("en-PH")}{" "}
              · no payment is collected.
            </p>
          )}
          {thread.replies.map((reply) => (
            <div className="reply" key={reply.id}>
              <span className="eyebrow">
                {reply.authorRole === "admin" ? "John" : "Company account"}
              </span>
              <p>{reply.body}</p>
            </div>
          ))}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              setBusy(true);
              try {
                await api(`/api/inbox/${thread.item.id}/replies`, {
                  method: "POST",
                  body: JSON.stringify({
                    body: new FormData(form).get("body"),
                  }),
                });
                form.reset();
                await open(thread.item.id);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Reply
              <textarea name="body" rows={3} required maxLength={12000} />
            </label>
            <button className="primary" disabled={busy}>
              Save reply
              <Send size={14} />
            </button>
          </form>
          {admin && (
            <form onSubmit={update} className="item-actions">
              <label>
                Status
                <select name="status" defaultValue={thread.item.status}>
                  {[
                    "new",
                    "in_progress",
                    "quoted",
                    "approved",
                    "done",
                    "rejected",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Size
                <select name="size" defaultValue={thread.item.size ?? ""}>
                  <option value="">Not sized</option>
                  {["small", "medium", "large", "custom"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Optional quote (PHP)
                <input
                  name="quote"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={thread.item.quotePhp ?? ""}
                />
              </label>
              {thread.item.visibility === "private" && (
                <label className="inline-check">
                  <input name="share" value="yes" type="checkbox" />
                  Explicitly share this note with the client
                </label>
              )}
              <button className="secondary" disabled={busy}>
                Update request
              </button>
            </form>
          )}
          {admin &&
            thread.item.kind === "change" &&
            thread.item.status === "approved" && (
              <button
                className="primary"
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await api<{ message: string }>(
                      `/api/admin/inbox/${thread.item.id}/reopen`,
                      { method: "POST", body: "{}" },
                    );
                    setNotice(r.message);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                Reopen only the approved affected sections
              </button>
            )}
        </article>
      ) : (
        <>
          <div className="inbox-list">
            {items.length === 0 && (
              <div className="empty-state">
                <h3>No conversations yet.</h3>
                <p>
                  Start with a question, or request a clearly scoped change.
                </p>
              </div>
            )}
            {items.map((item) => (
              <button
                className="project-row"
                key={item.id}
                onClick={() => void open(item.id)}
              >
                <span className="project-name">
                  <strong>
                    {item.subject}
                    {(admin ? !item.adminReadAt : !item.clientReadAt)
                      ? " · New"
                      : ""}
                  </strong>
                  <small>
                    {item.kind} · {item.visibility}
                  </small>
                </span>
                <span className="pill">{item.status}</span>
              </button>
            ))}
          </div>
          <form className="workflow-card" onSubmit={submit}>
            <h2>Start a conversation</h2>
            <label>
              Type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="question">Question for John</option>
                <option value="change">Change or upgrade request</option>
                <option value="issue">Website correction report</option>
                {admin && <option value="note">Owner note</option>}
              </select>
            </label>
            <label>
              Subject
              <input name="subject" minLength={2} maxLength={200} required />
            </label>
            <label>
              Related section
              <select
                name="section"
                key={initialSection + sections.length}
                defaultValue={initialSection}
              >
                <option value="">General project question</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            {kind === "change" && (
              <>
                <label>
                  Classification
                  <select name="classification">
                    <option value="correction">
                      Correction against agreed scope
                    </option>
                    <option value="change">Change within the project</option>
                    <option value="upgrade">Upgrade or added scope</option>
                  </select>
                </label>
                <p className="muted small">
                  For an upgrade, you may request a new section. It stays locked
                  until John approves and amends the package.
                </p>
                <div className="multiselect-grid">
                  {definitions.map((s) => (
                    <label key={s.id}>
                      <input type="checkbox" name="affected" value={s.id} />
                      {s.title}
                    </label>
                  ))}
                </div>
              </>
            )}
            <label>
              Message
              <textarea name="body" rows={4} required maxLength={12000} />
            </label>
            {admin && kind === "note" && (
              <label className="inline-check">
                <input
                  type="checkbox"
                  name="private"
                  value="yes"
                  defaultChecked
                />
                Keep this note private to the owner
              </label>
            )}
            <button className="primary" disabled={busy}>
              Save conversation
              <Plus size={15} />
            </button>
          </form>
        </>
      )}
    </section>
  );
}
function ProjectControls({ id }: { id: string }) {
  const [data, setData] = useState<ReviewData | null>(null),
    [packages, setPackages] = useState<
      { id: string; version: number; config: PackageConfig }[]
    >([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [manual, setManual] = useState(false);
  const load = useCallback(async () => {
    const d = await api<ReviewData>(`/api/projects/${id}/review`);
    setData(d);
    setManual(!!d.control.manualScope);
  }, [id]);
  useEffect(() => {
    void Promise.all([
      api<ReviewData>(`/api/projects/${id}/review`),
      api<{ packages: typeof packages }>("/api/packages"),
    ])
      .then(([d, p]) => {
        setData(d);
        setManual(!!d.control.manualScope);
        setPackages(p.packages);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(`/api/admin/projects/${id}/control`, {
        method: "PUT",
        body: JSON.stringify({
          revision: data!.control.revision,
          scopeReference: f.get("scopeReference"),
          ...(f.get("scopeRequestId")
            ? {
                requestId: f.get("scopeRequestId"),
                reason: f.get("scopeReason"),
              }
            : {}),
          manualScope: manual
            ? {
                approved: true,
                reference: f.get("manualReference"),
                maxPages: Number(f.get("maxPages")),
                inquiry: f.get("inquiry") === "yes",
                reservation: f.get("reservation") === "yes",
                booking: f.get("booking") === "yes",
              }
            : null,
          launchAt: f.get("launchAt")
            ? new Date(
                String(f.get("launchAt")) + "T00:00:00+08:00",
              ).toISOString()
            : null,
          testUrl: f.get("testUrl"),
          approverName: f.get("approverName"),
          approverEmail: f.get("approverEmail"),
          approverMethod: f.get("approverMethod"),
          approverVerified: f.get("approverVerified") === "yes",
        }),
      });
      setNotice("Project controls saved.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <>
        <ErrorNotice error={error} />
        <p className="muted">Loading owner controls…</p>
      </>
    );
  const current = (category: string) =>
    data.assigned.find(
      (a) =>
        a.category === category ||
        (category === "base" && ["website", "portfolio"].includes(a.category)),
    )?.packageVersionId ?? "";
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            OWNER CONTROLS · REVISION {data.control.revision}
          </span>
          <h1>A clear scope. A secure workspace.</h1>
        </div>
      </div>
      <ErrorNotice error={error} />
      {notice && (
        <p className="success-panel" role="status">
          {notice}
        </p>
      )}
      <div className="workflow-grid">
        <form
          className="workflow-card"
          key={data.control.revision}
          onSubmit={save}
        >
          <h2>Scope, launch & approver</h2>
          {data.control.baselineVersion > 0 && (
            <>
              <p className="muted small">
                Changing the written scope requires an approved upgrade against
                this baseline. Reopen the request first; earlier approved
                records stay unchanged.
              </p>
              <label>
                Approved scope upgrade request ID
                <input name="scopeRequestId" />
              </label>
              <label>
                Reason for written scope amendment
                <textarea name="scopeReason" minLength={5} maxLength={2000} />
              </label>
            </>
          )}
          <label>
            Contract / approved scope reference
            <input
              name="scopeReference"
              required
              maxLength={1000}
              defaultValue={data.project.scopeReference ?? ""}
            />
          </label>
          {data.config.id === "bookingsuite" && (
            <>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={manual}
                  onChange={(e) => setManual(e.target.checked)}
                />
                Record an explicitly approved written BookingSuite scope
              </label>
              {manual && (
                <>
                  <label>
                    Written scope reference
                    <textarea
                      name="manualReference"
                      required
                      minLength={5}
                      defaultValue={data.control.manualScope?.reference}
                    />
                  </label>
                  <label>
                    Approved page cap
                    <input
                      name="maxPages"
                      type="number"
                      min={1}
                      max={100}
                      required
                      defaultValue={data.control.manualScope?.maxPages}
                    />
                  </label>
                  {(["inquiry", "reservation", "booking"] as const).map(
                    (key) => (
                      <label className="inline-check" key={key}>
                        <input
                          name={key}
                          value="yes"
                          type="checkbox"
                          defaultChecked={data.control.manualScope?.[key]}
                        />
                        {key === "reservation"
                          ? "Manual reservation request"
                          : key === "inquiry"
                            ? "Ordinary inquiry form"
                            : "Custom real-time booking requirements"}
                      </label>
                    ),
                  )}
                </>
              )}
            </>
          )}
          <label>
            Website launch date
            <input
              name="launchAt"
              type="date"
              defaultValue={data.control.launchAt?.slice(0, 10)}
            />
            <small>
              Complimentary care begins at recorded launch, not account
              creation.
            </small>
          </label>
          <label>
            Test website URL
            <input
              name="testUrl"
              type="url"
              defaultValue={data.control.testUrl ?? ""}
            />
          </label>
          <label>
            Authorized approver name
            <input
              name="approverName"
              maxLength={200}
              defaultValue={data.control.approverName ?? ""}
            />
          </label>
          <label>
            Authorized approver email
            <input
              name="approverEmail"
              type="email"
              defaultValue={data.control.approverEmail ?? ""}
            />
          </label>
          <label>
            Independent verification method
            <textarea
              name="approverMethod"
              rows={3}
              defaultValue={data.control.approverMethod ?? ""}
            />
          </label>
          <label className="inline-check">
            <input
              name="approverVerified"
              type="checkbox"
              value="yes"
              defaultChecked={!!data.control.approverVerifiedAt}
            />
            I independently established this person’s authority and agreed
            delivery channel.
          </label>
          <button className="primary" disabled={busy}>
            Save controls
            <Check size={15} />
          </button>
        </form>
        <div>
          <form
            className="workflow-card"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setBusy(true);
              try {
                const r = await api<{ message: string }>(
                  `/api/admin/projects/${id}/packages`,
                  {
                    method: "POST",
                    body: JSON.stringify({
                      revision: data.control.revision,
                      versionIds: ["base", "cms", "seo", "care"]
                        .map((k) => f.get(k))
                        .filter(Boolean),
                      reason: f.get("reason"),
                      ...(f.get("requestId")
                        ? { requestId: f.get("requestId") }
                        : {}),
                    }),
                  },
                );
                setNotice(r.message);
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>Versioned package amendment</h2>
            <p className="muted small">
              Existing approved versions are never changed. An approved upgrade
              request is required after the first baseline.
            </p>
            <div className="scope-select-grid">
              {["base", "cms", "seo", "care"].map((category) => (
                <label key={category}>
                  {category === "base"
                    ? "Website or portfolio package"
                    : category.toUpperCase()}
                  <select
                    name={category}
                    defaultValue={current(category)}
                    required={category === "base"}
                  >
                    {category !== "base" && <option value="">None</option>}
                    {packages
                      .filter((p) =>
                        category === "base"
                          ? ["website", "portfolio"].includes(p.config.category)
                          : p.config.category === category,
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.config.name} · v{p.version}
                          {p.config.category === "cms"
                            ? ` · ${p.config.editableSections ?? "unset"} editable sections`
                            : ""}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
            <label>
              Amendment reason
              <textarea name="reason" minLength={5} maxLength={2000} required />
            </label>
            {data.control.baselineVersion > 0 && (
              <label>
                Approved upgrade request ID
                <input name="requestId" required />
              </label>
            )}
            <button className="primary" disabled={busy}>
              Apply audited amendment
            </button>
          </form>
          <section className="workflow-card">
            <h2>Company access</h2>
            <p className="muted small">
              Suspending or archiving revokes company sessions. Archiving
              preserves approved records.
            </p>
            <div className="item-actions">
              {(
                ["suspend", "reactivate", "revoke_sessions", "archive"] as const
              ).map((action) => (
                <button
                  className="secondary"
                  key={action}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const r = await api<{ message: string }>(
                        `/api/admin/companies/${data.project.companyId}/access`,
                        { method: "POST", body: JSON.stringify({ action }) },
                      );
                      setNotice(r.message);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {action.replaceAll("_", " ")}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
function CheckupPanel({ id }: { id: string }) {
  const [data, setData] = useState<{
      testUrl: string | null;
      version: number;
      baseline: FrozenSubmission | null;
      reviews: {
        path: string;
        status: string;
        notes: string;
        evidenceLinks: string[];
      }[];
    } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<typeof data>(`/api/projects/${id}/checkup`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">WEBSITE CHECKUP</span>
          <h1>Does it match the agreed brief?</h1>
          <p className="muted">
            Each page review refers to its exact approved requirements version.
          </p>
        </div>
      </div>
      <ErrorNotice error={error} />
      {notice && (
        <p className="success-panel" role="status">
          {notice}
        </p>
      )}
      {!data?.baseline ? (
        <div className="empty-state">
          <h3>An approved baseline comes first.</h3>
          <p>
            The checkup opens after verified approval and a test website link.
          </p>
        </div>
      ) : (
        <>
          <div className="review-toolbar">
            <span className="pill">Approved baseline v{data.version}</span>
            {data.testUrl ? (
              <a
                className="primary"
                href={data.testUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open test website ↗
              </a>
            ) : (
              <p className="muted small">
                John has not added a test website link yet.
              </p>
            )}
          </div>
          {routePaths(data.baseline.answers).map((path) => {
            const saved = data.reviews.find((r) => r.path === path);
            return (
              <form
                className="workflow-card"
                key={path}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  try {
                    await api(`/api/projects/${id}/checkup`, {
                      method: "PUT",
                      body: JSON.stringify({
                        version: data.version,
                        path,
                        status: f.get("status"),
                        notes: f.get("notes"),
                        evidenceLinks: String(f.get("evidence") ?? "")
                          .split("\n")
                          .filter(Boolean),
                      }),
                    });
                    setNotice(
                      "Page review saved against approved version " +
                        data.version +
                        ".",
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <h2>{path}</h2>
                <label>
                  Review result
                  <select
                    name="status"
                    defaultValue={saved?.status ?? "not_reviewed"}
                  >
                    <option value="not_reviewed">Not reviewed</option>
                    <option value="matches">
                      Matches approved requirements
                    </option>
                    <option value="needs_correction">Needs correction</option>
                  </select>
                </label>
                <label>
                  Notes
                  <textarea name="notes" rows={3} defaultValue={saved?.notes} />
                </label>
                <label>
                  External evidence links
                  <textarea
                    name="evidence"
                    rows={2}
                    defaultValue={saved?.evidenceLinks?.join("\n")}
                    placeholder="HTTPS image or document links, one per line"
                  />
                </label>
                <button className="secondary" disabled={busy}>
                  Save page review
                </button>
              </form>
            );
          })}
          <ContentPreview
            sections={data.baseline.sections}
            saved={data.baseline.answers}
          />
        </>
      )}
    </section>
  );
}
