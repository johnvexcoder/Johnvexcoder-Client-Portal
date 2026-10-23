import { useEffect, useState } from "react";
import { api } from "../lib/api";
interface PublicPolicies {
  published: boolean;
  privacy: { text: string; version: string };
  terms: { text: string; version: string };
  supportEmail: string;
}
export function PolicyPage({ kind }: { kind: "privacy" | "terms" }) {
  const [data, setData] = useState<PublicPolicies | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    void api<PublicPolicies>("/api/policies")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  const title = kind === "privacy" ? "Privacy Notice" : "Terms of Use";
  return (
    <main className="policy-page">
      <a className="policy-brand" href="/">
        <img src="/icon.svg" width={38} height={38} alt="J0hnvexcoder" />
        <span>J0hnvexcoder · Client workspace</span>
      </a>
      <section className="workflow-card">
        <span className="eyebrow">PORTAL POLICIES</span>
        <h1>{title}</h1>
        {error ? (
          <p className="error-panel" role="alert">
            {error}
          </p>
        ) : !data ? (
          <p>Loading policy…</p>
        ) : !data.published ? (
          <div className="scope-note">
            <h2>Policy publication pending</h2>
            <p>
              John has not published the portal policies yet. Contact him
              through your agreed channel before sharing personal information.
              This development page does not represent an approved policy.
            </p>
          </div>
        ) : (
          <>
            <p className="muted small">
              Published version: {data[kind].version}
            </p>
            <div className="policy-content">{data[kind].text}</div>
            {data.supportEmail && (
              <p>
                Policy questions:{" "}
                <a href={"mailto:" + data.supportEmail}>{data.supportEmail}</a>
              </p>
            )}
          </>
        )}
        <nav aria-label="Policy navigation">
          <a href="/">Back to sign in</a>
          <a href={kind === "privacy" ? "/terms" : "/privacy"}>
            {kind === "privacy" ? "Terms of Use" : "Privacy Notice"}
          </a>
        </nav>
      </section>
    </main>
  );
}
