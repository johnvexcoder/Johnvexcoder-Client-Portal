import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Check, Copy, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { defaultSettings, type Settings } from "../features/admin-settings";
export function RotateCredential({
  onComplete,
  signOut,
}: {
  onComplete: () => Promise<void>;
  signOut: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (data.get("password") !== data.get("confirmation")) {
      setError("The new credentials do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/account/rotate", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: data.get("currentPassword"),
          password: data.get("password"),
        }),
      });
      await onComplete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mfa-card">
      <span className="security-icon">
        <ShieldCheck size={28} />
      </span>
      <span className="eyebrow">MAKE YOUR WORKSPACE YOURS</span>
      <h1>
        Choose your
        <br />
        private credential.
      </h1>
      <p className="muted">
        Replace the temporary credential John shared before opening your
        project. Use at least 16 characters.
      </p>
      <form onSubmit={submit}>
        <label>
          Temporary credential
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          New credential
          <input
            name="password"
            type="password"
            minLength={16}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Confirm new credential
          <input
            name="confirmation"
            type="password"
            minLength={16}
            maxLength={128}
            autoComplete="new-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Updating…" : "Update & open workspace"}
          <ArrowRight size={17} />
        </button>
      </form>
      <button className="text-button" onClick={signOut}>
        Sign out
      </button>
    </main>
  );
}
export function SettingsPanel() {
  const [value, setValue] = useState<Settings>(defaultSettings),
    [revision, setRevision] = useState(0),
    [gaps, setGaps] = useState<string[]>([]),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  useEffect(() => {
    let alive = true;
    void api<{ value: Settings; revision: number; gaps: string[] }>(
      "/api/admin/settings",
    )
      .then((d) => {
        if (alive) {
          setValue(d.value);
          setRevision(d.revision);
          setGaps(d.gaps);
          setReady(true);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      alive = false;
    };
  }, []);
  const update = <K extends keyof Settings>(key: K, v: Settings[K]) =>
    setValue((s) => ({ ...s, [key]: v }));
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const d = await api<{
        value: Settings;
        revision: number;
        gaps: string[];
      }>("/api/admin/settings", {
        method: "PUT",
        body: JSON.stringify({ revision, value }),
      });
      setValue(d.value);
      setRevision(d.revision);
      setGaps(d.gaps);
      setNotice(
        "Settings saved. Changed CMS caps were published as new package versions for future assignments. Existing project scope stays frozen.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="operations-panel">
      <div className="page-heading">
        <div>
          <span className="eyebrow">OWNER CONTROLS · VERSION {revision}</span>
          <h1>Make the workspace yours.</h1>
          <p className="muted">
            Agreement wording and retention remain your explicit decisions.
          </p>
        </div>
      </div>
      {gaps.length > 0 && (
        <div className="reference-banner">
          <p>Before real-client signoff, complete: {gaps.join("; ")}.</p>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!ready ? (
        <p className="muted">Loading settings…</p>
      ) : (
        <form onSubmit={save} className="operations-form">
          <fieldset>
            <legend>Welcome & support</legend>
            <label>
              Welcome message
              <textarea
                rows={4}
                value={value.welcomeTemplate}
                onChange={(e) => update("welcomeTemplate", e.target.value)}
                required
              />
              <small>
                Available placeholders:{" "}
                {"{{company}}, {{portalUrl}}, {{email}}"}. Credentials are
                shared separately.
              </small>
            </label>
            {(
              [
                "supportEmail",
                "supportPhone",
                "facebook",
                "whatsapp",
                "portfolio",
              ] as const
            ).map((k) => (
              <label key={k}>
                {
                  {
                    supportEmail: "Support email",
                    supportPhone: "Support phone",
                    facebook: "Facebook link",
                    whatsapp: "WhatsApp link",
                    portfolio: "Portfolio link",
                  }[k]
                }
                <input
                  value={value[k]}
                  onChange={(e) => update(k, e.target.value)}
                  type={
                    k === "supportEmail"
                      ? "email"
                      : k === "supportPhone"
                        ? "text"
                        : "url"
                  }
                />
              </label>
            ))}
            <label className="inline-check">
              <input
                type="checkbox"
                checked={value.appearOffline}
                onChange={(e) => update("appearOffline", e.target.checked)}
              />
              Appear offline to clients
            </label>
          </fieldset>
          <fieldset>
            <legend>Login-page Privacy Notice and Terms of Use</legend>
            <p className="muted small">
              These public portal policies are separate from the project
              approval agreement. Unpublished drafts stay private. Supply
              reviewed wording and a version for each before publication.
            </p>
            <label>
              Privacy Notice version
              <input
                value={value.privacyNoticeVersion}
                maxLength={100}
                onChange={(e) => update("privacyNoticeVersion", e.target.value)}
              />
            </label>
            <label>
              Privacy Notice text
              <textarea
                rows={8}
                maxLength={20000}
                value={value.privacyNoticeText}
                onChange={(e) => update("privacyNoticeText", e.target.value)}
              />
            </label>
            <label>
              Portal Terms version
              <input
                value={value.portalTermsVersion}
                maxLength={100}
                onChange={(e) => update("portalTermsVersion", e.target.value)}
              />
            </label>
            <label>
              Portal Terms of Use text
              <textarea
                rows={8}
                maxLength={20000}
                value={value.portalTermsText}
                onChange={(e) => update("portalTermsText", e.target.value)}
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={value.policiesPublished}
                onChange={(e) => update("policiesPublished", e.target.checked)}
              />
              I reviewed both policies and choose to publish them on the sign-in
              page.
            </label>
          </fieldset>
          <fieldset>
            <legend>CMS editable-section caps</legend>
            <p className="muted small">
              These limits are separate from delivered-site admin seats. Saving
              a changed cap creates a new immutable package version; existing
              clients need an explicit amendment.
            </p>
            {(["controlcore", "cataloglayer", "workflowdesk"] as const).map(
              (id) => (
                <label key={id}>
                  {
                    {
                      controlcore: "ControlCore · 2 staff seats",
                      cataloglayer: "CatalogLayer · 3 staff seats",
                      workflowdesk: "WorkflowDesk · 5 staff seats",
                    }[id]
                  }
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={value.cmsCaps[id] ?? ""}
                    onChange={(e) =>
                      update("cmsCaps", {
                        ...value.cmsCaps,
                        [id]: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    placeholder="Owner decision required"
                  />
                </label>
              ),
            )}
          </fieldset>
          <fieldset>
            <legend>Approval wording & independent verification</legend>
            <label>
              Agreement text
              <textarea
                value={value.termsText}
                onChange={(e) => update("termsText", e.target.value)}
                rows={7}
                placeholder="Your reviewed agreement wording; do not use placeholder legal text."
              />
            </label>
            <label>
              Terms version
              <input
                value={value.termsVersion}
                onChange={(e) => update("termsVersion", e.target.value)}
                placeholder="For example, your dated terms reference"
              />
            </label>
            <label>
              Authorized-approver verification procedure
              <textarea
                value={value.verificationProtocol}
                onChange={(e) => update("verificationProtocol", e.target.value)}
                rows={4}
                placeholder="Explain how you establish authority and deliver a separate one-time challenge through an agreed verified channel."
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={value.termsApproved}
                onChange={(e) => update("termsApproved", e.target.checked)}
              />
              I have reviewed and approved this wording and verification
              procedure for use.
            </label>
          </fieldset>
          <fieldset>
            <legend>Retention & backups</legend>
            <label>
              Approved-content retention (days)
              <input
                type="number"
                min={1}
                max={36500}
                value={value.approvedRetentionDays ?? ""}
                onChange={(e) =>
                  setValue({
                    ...value,
                    approvedRetentionDays: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </label>
            <label>
              Client-message retention (days)
              <input
                type="number"
                min={1}
                max={36500}
                value={value.messageRetentionDays ?? ""}
                onChange={(e) =>
                  setValue({
                    ...value,
                    messageRetentionDays: e.target.value
                      ? Number(e.target.value)
                      : null,
                  })
                }
              />
            </label>
            <label>
              Archived records retained for (days)
              <input
                type="number"
                min={1}
                max={36500}
                value={value.archivedRetentionDays ?? ""}
                onChange={(e) =>
                  update(
                    "archivedRetentionDays",
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
              <small>
                Archiving preserves approved records. Permanent deletion is an
                explicit offline operator procedure.
              </small>
            </label>
            <label>
              Backup cadence (days, maximum 7)
              <input
                type="number"
                min={1}
                max={7}
                value={value.backupCadenceDays ?? ""}
                onChange={(e) =>
                  update(
                    "backupCadenceDays",
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
              <small>
                Saving a cadence records the policy. It does not schedule or
                create a backup.
              </small>
            </label>
          </fieldset>
          {notice && (
            <p className="success-panel" role="status">
              {notice}
            </p>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Saving…" : "Save versioned settings"}
            <Check size={16} />
          </button>
        </form>
      )}
    </section>
  );
}
interface Recovery {
  id: string;
  companyId: string;
  company: string;
  email: string;
  status: string;
  createdAt: string;
}
export function RecoveryPanel() {
  const [items, setItems] = useState<Recovery[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(""),
    [issued, setIssued] = useState<{ token: string; expiresAt: number } | null>(
      null,
    ),
    [revealed, setRevealed] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    void api<{ requests: Recovery[] }>("/api/admin/recovery")
      .then((d) => setItems(d.requests))
      .catch((e) => setError(e.message));
  }, []);
  async function issue(id: string) {
    setBusy(id);
    setError("");
    try {
      setIssued(
        await api("/api/admin/recovery/" + id + "/issue", {
          method: "POST",
          body: "{}",
        }),
      );
      setRevealed(false);
      const d = await api<{ requests: Recovery[] }>("/api/admin/recovery");
      setItems(d.requests);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">OWNER-APPROVED RECOVERY</span>
          <h1>A secure way back in.</h1>
          <p className="muted">
            Verify the requester independently before issuing a one-time
            recovery token.
          </p>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {issued && (
        <section className="credential-box">
          <strong>Recovery token · expires in 15 minutes</strong>
          <p className="muted small">
            Share this separately through the verified agreed channel. The
            portal sends no email.
          </p>
          {revealed ? (
            <code>{issued.token}</code>
          ) : (
            <button className="secondary" onClick={() => setRevealed(true)}>
              Reveal recovery token
            </button>
          )}
          <button
            className="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(issued.token);
                setNotice("Token copied.");
              } catch {
                setError("Clipboard unavailable; reveal and copy manually.");
              }
            }}
          >
            <Copy size={15} />
            Copy token
          </button>
          <button className="text-button" onClick={() => setIssued(null)}>
            Hide and finish
          </button>
        </section>
      )}
      {notice && (
        <p role="status" className="success-panel">
          {notice}
        </p>
      )}
      {items.length === 0 ? (
        <div className="empty-state">
          <h3>No recovery requests.</h3>
          <p>Requests from active clients will appear here.</p>
        </div>
      ) : (
        <div className="project-list">
          {items.map((item) => (
            <div className="project-row" key={item.id}>
              <div className="project-name">
                <strong>{item.company}</strong>
                <small>{item.email}</small>
              </div>
              <span className="pill">{item.status}</span>
              {["new", "issued"].includes(item.status) && (
                <button
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => void issue(item.id)}
                >
                  {busy === item.id
                    ? "Issuing…"
                    : item.status === "issued"
                      ? "Replace token"
                      : "Issue recovery"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
export function AuditPanel() {
  const [events, setEvents] = useState<
      { id: string; action: string; targetId: string; createdAt: string }[]
    >([]),
    [offset, setOffset] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    void api<{ events: typeof events }>("/api/admin/audit?offset=" + offset)
      .then((d) => setEvents(d.events))
      .catch((e) => setError(e.message));
  }, [offset]);
  return (
    <section>
      <div className="page-heading">
        <div>
          <span className="eyebrow">OWNER AUDIT TRAIL</span>
          <h1>Actions, clearly recorded.</h1>
          <p className="muted">
            Credentials, tokens and questionnaire contents are excluded from
            these records.
          </p>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="project-list">
        {events.map((e) => (
          <div className="project-row" key={e.id}>
            <span className="project-name">
              <strong>{e.action.replaceAll(".", " · ")}</strong>
              <small>{e.targetId}</small>
            </span>
            <time className="muted small">
              {new Date(e.createdAt).toLocaleString("en-PH", {
                timeZone: "Asia/Manila",
              })}{" "}
              PHT
            </time>
          </div>
        ))}
      </div>
      <div className="pagination">
        <button
          className="secondary"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 100))}
        >
          Previous
        </button>
        <button
          className="secondary"
          disabled={events.length < 100}
          onClick={() => setOffset(offset + 100)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
