import React, { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { PolicyPage } from "./components/PolicyPage";
import { App } from "./App";
import "./styles/app.css";
import "./styles/login.css";
import "./styles/workflows.css";
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <main className="mfa-card">
        <h1>Let’s reopen your workspace.</h1>
        <p className="muted">
          Something prevented this view from opening. Reload and check the last
          saved version before continuing.
        </p>
        <button className="primary" onClick={() => window.location.reload()}>
          Reload workspace
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
const knownPath = window.location.pathname === "/";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {knownPath ? (
        <App />
      ) : window.location.pathname === "/privacy" ||
        window.location.pathname === "/terms" ? (
        <PolicyPage
          kind={window.location.pathname === "/privacy" ? "privacy" : "terms"}
        />
      ) : (
        <main className="mfa-card">
          <span className="eyebrow">404 · PAGE NOT FOUND</span>
          <h1>
            This page has moved
            <br />
            out of the picture.
          </h1>
          <p className="muted">
            Return to your workspace to pick up where you left off.
          </p>
          <a className="primary" href="/">
            Return to workspace
          </a>
        </main>
      )}
    </ErrorBoundary>
  </React.StrictMode>,
);
