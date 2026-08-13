"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Persistence = "mongodb" | "fixture";
type RunStatus =
  | "queued"
  | "retrieving"
  | "interrupted"
  | "reasoning"
  | "completed";

type DemoRun = {
  id: string;
  status: RunStatus;
  retrievalAuditId?: string;
  decision?: { action: "PASS" | "REVISIT" };
};

type AuditCandidate = {
  id: string;
  text: string;
  score: number;
  accepted?: boolean;
};

type DemoAudit = {
  id: string;
  query: string;
  selectedUnitIds: string[];
  packetHash: string;
  filter: { workspaceId: string; dealId: string; active: true };
  candidates: AuditCandidate[];
  checkpoint: { id: string; state: "retrieved" };
  retrieval: {
    mode: "atlas-vector" | "mongodb-cosine-fallback" | "fixture";
    indexName: string;
    indexReady: boolean;
  };
};

type DemoSnapshot = {
  persistence: Persistence;
  runs: DemoRun[];
  audits: DemoAudit[];
};

type MutationResponse = {
  error?: string;
  persistence?: Persistence;
  run?: DemoRun;
};

type Action = "run" | "interrupt" | "resume" | "reset";

const API_ERROR = "The demo service could not be reached. The evidence narrative remains available.";

function makeIdempotencyKey(action: "run" | "interrupt") {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `vsee-${action}-${id}`;
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export default function DemoExperience() {
  const [snapshot, setSnapshot] = useState<DemoSnapshot | null>(null);
  const [persistence, setPersistence] = useState<Persistence>("fixture");
  const [busy, setBusy] = useState<Action | null>(null);
  const [status, setStatus] = useState(
    "Ready. Run the fixed-scope context loop or interrupt it after retrieval.",
  );
  const [error, setError] = useState<string | null>(null);
  const [recoveredAuditId, setRecoveredAuditId] = useState<string | null>(null);
  const idempotencyKeys = useRef<Partial<Record<"run" | "interrupt", string>>>({});

  const latestRun = snapshot?.runs[snapshot.runs.length - 1];
  const latestAudit = useMemo(
    () =>
      latestRun?.retrievalAuditId
        ? snapshot?.audits.find((audit) => audit.id === latestRun.retrievalAuditId)
        : snapshot?.audits[snapshot.audits.length - 1],
    [latestRun, snapshot],
  );
  const resumableRun = latestRun?.status === "interrupted" ? latestRun : undefined;

  async function refreshSnapshot() {
    const response = await fetch("/api/demo", { cache: "no-store" });
    const payload = await readJson<DemoSnapshot & { error?: string }>(response);
    if (!response.ok) throw new Error(payload.error || API_ERROR);
    setSnapshot(payload);
    setPersistence(payload.persistence === "mongodb" ? "mongodb" : "fixture");
    return payload;
  }

  useEffect(() => {
    let cancelled = false;

    fetch("/api/demo", { cache: "no-store" })
      .then(async (response) => {
        const payload = await readJson<DemoSnapshot & { error?: string }>(response);
        if (!response.ok) throw new Error(payload.error || API_ERROR);
        if (!cancelled) {
          setSnapshot(payload);
          setPersistence(payload.persistence === "mongodb" ? "mongodb" : "fixture");
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : API_ERROR);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function postWithIdempotency(action: "run" | "interrupt") {
    setBusy(action);
    setError(null);
    setRecoveredAuditId(null);
    setStatus(action === "run" ? "Retrieving persistent context…" : "Retrieving context before a simulated interruption…");

    const key = idempotencyKeys.current[action] ?? makeIdempotencyKey(action);
    idempotencyKeys.current[action] = key;

    try {
      const response = await fetch(`/api/demo/${action}`, {
        method: "POST",
        headers: { "Idempotency-Key": key },
      });
      const payload = await readJson<MutationResponse>(response);
      if (!response.ok || !payload.run) throw new Error(payload.error || API_ERROR);
      setPersistence(payload.persistence === "mongodb" ? "mongodb" : "fixture");
      await refreshSnapshot();
      delete idempotencyKeys.current[action];
      setStatus(
        action === "run"
          ? "Context matched. Decision updated to REVISIT with a stored retrieval audit."
          : "Interrupted on purpose. The retrieval audit and checkpoint are already stored.",
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : API_ERROR);
      setStatus("Action paused. Retry will reuse the same idempotency key.");
    } finally {
      setBusy(null);
    }
  }

  async function resume(run: DemoRun) {
    setBusy("resume");
    setError(null);
    setStatus("Resuming from the stored checkpoint — no second retrieval…");
    const originalAuditId = run.retrievalAuditId;

    try {
      const response = await fetch("/api/demo/resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: run.id }),
      });
      const payload = await readJson<MutationResponse>(response);
      if (!response.ok || !payload.run) throw new Error(payload.error || API_ERROR);
      setPersistence(payload.persistence === "mongodb" ? "mongodb" : "fixture");
      await refreshSnapshot();
      if (originalAuditId && payload.run.retrievalAuditId === originalAuditId) {
        setRecoveredAuditId(originalAuditId);
        setStatus("Recovered. The completed decision reused the exact same retrieval audit ID.");
      } else {
        setStatus("Recovered from the stored checkpoint.");
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : API_ERROR);
      setStatus("Resume paused. The stored checkpoint remains available.");
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    setError(null);
    setStatus("Resetting the fixed demo scope…");
    try {
      const response = await fetch("/api/demo/reset", { method: "POST" });
      const payload = await readJson<DemoSnapshot & { error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || API_ERROR);
      setSnapshot(payload);
      setPersistence(payload.persistence === "mongodb" ? "mongodb" : "fixture");
      idempotencyKeys.current = {};
      setRecoveredAuditId(null);
      setStatus("Demo reset. The original pass and new evidence are ready.");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : API_ERROR);
      setStatus("Reset could not complete. The visible narrative is unchanged.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <header className="masthead page-shell">
        <a className="wordmark" href="#top" aria-label="VSee home">
          <span className="wordmark-mark" aria-hidden="true">V</span>
          <span>VSEE</span>
        </a>
        <div className="issue-line">
          <span>Persistent Context Brief</span>
          <span aria-hidden="true">/</span>
          <time dateTime="2026-08-13">13 AUG 2026</time>
        </div>
        <div
          className={`persistence-badge ${persistence === "mongodb" ? "is-live" : ""}`}
          title="Verified from the server response"
        >
          <span className="status-dot" aria-hidden="true" />
          {persistence === "mongodb" ? "LIVE ATLAS" : "DEMO FIXTURE"}
        </div>
      </header>

      <section className="hero page-shell" id="top">
        <p className="eyebrow">Venture decisions, re-opened by evidence</p>
        <h1>The agent that knows when your “No” is outdated.</h1>
        <div className="hero-support">
          <p>
            Persistent context turns a forgotten pass into the right next move —
            with every retrieval and checkpoint visible.
          </p>
          <p className="case-note">
            <span>Case 001</span>
            Irregular · Growth investment memo
          </p>
        </div>
      </section>

      <section className="decision-story page-shell" aria-labelledby="story-title">
        <h2 className="sr-only" id="story-title">Then, now, and next decision sequence</h2>

        <article className="story-panel story-then">
          <div className="story-heading">
            <span className="step-number">01</span>
            <h3>Then</h3>
            <time dateTime="2025-11-10">10 Nov 2025</time>
          </div>
          <div className="decision-word">PASS</div>
          <p className="metric-label">Net retention</p>
          <p className="metric-value">78%</p>
          <blockquote>
            “Retention is below our threshold. Revisit after two quarters above 90%.”
          </blockquote>
          <p className="source-line"><span>Source</span> Partner decision memo</p>
        </article>

        <div className="sequence-arrow" aria-hidden="true">
          <span>context persists</span>
          <b>→</b>
        </div>

        <article className="story-panel story-now">
          <div className="story-heading">
            <span className="step-number">02</span>
            <h3>Now</h3>
            <time dateTime="2026-08-13">13 Aug 2026</time>
          </div>
          <div className="confirmed-label"><span aria-hidden="true">✓</span> Confirmed investor update</div>
          <div className="quarter-pair" aria-label="Net retention evidence">
            <div>
              <strong>Q1 · 91%</strong>
            </div>
            <div>
              <strong>Q2 · 92%</strong>
            </div>
          </div>
          <p className="evidence-copy">
            Both new observations clear the exact revisit condition saved nine months ago.
          </p>
          <p className="source-line"><span>Source</span> Verified company update</p>
        </article>

        <div className="sequence-arrow" aria-hidden="true">
          <span>condition matches</span>
          <b>→</b>
        </div>

        <article className="story-panel story-next">
          <div className="story-heading">
            <span className="step-number">03</span>
            <h3>Next</h3>
            <span className="date-placeholder">Today</span>
          </div>
          <div className="decision-word changed">REVISIT</div>
          <p className="recommendation-kicker">Recommended action</p>
          <p className="recommendation">Open a partner meeting</p>
          <p className="decision-reason">
            The remembered threshold required two periods above 90%. The new evidence is 91% and 92% — so the prior “No” is no longer current.
          </p>
          <p className="source-line"><span>Output</span> Deterministic decision rule</p>
        </article>
      </section>

      <section className="demo-console page-shell" aria-labelledby="console-title">
        <div className="console-intro">
          <p className="eyebrow">Inspect the loop</p>
          <h2 id="console-title">Make the memory prove itself.</h2>
          <p>
            Run it cleanly, or interrupt after retrieval. The checkpoint remains durable,
            so resume reasons over the same evidence packet instead of searching twice.
          </p>
        </div>

        <div className="console-controls">
          <div className="primary-actions">
            <button
              className="button button-primary"
              disabled={busy !== null}
              onClick={() => postWithIdempotency("run")}
              type="button"
            >Run context loop</button>
            <button
              className="button button-secondary"
              disabled={busy !== null}
              onClick={() => postWithIdempotency("interrupt")}
              type="button"
            >Prove crash recovery</button>
          </div>

          {resumableRun ? (
            <div className="resume-callout">
              <div>
                <span className="resume-kicker">Checkpoint ready</span>
                <strong>Retrieval survived the interruption.</strong>
              </div>
              <button
                className="button button-resume"
                disabled={busy !== null}
                onClick={() => resume(resumableRun)}
                type="button"
              >Resume from checkpoint</button>
            </div>
          ) : null}

          {recoveredAuditId ? (
            <div className="recovery-proof" role="status">
              <span aria-hidden="true">✓</span>
              <p>
                <strong>Same evidence, no second retrieval.</strong>
                Audit <code>{recoveredAuditId}</code> was reused to complete REVISIT.
              </p>
            </div>
          ) : null}

          <div className="status-row">
            <p className="live-status" aria-live="polite" aria-atomic="true">
              <span className={busy ? "pulse-dot" : "quiet-dot"} aria-hidden="true" />
              {status}
            </p>
            <button
              className="reset-button"
              disabled={busy !== null}
              onClick={reset}
              type="button"
            >Reset demo</button>
          </div>
          {error ? <p className="error-message" role="alert">{error}</p> : null}
        </div>
      </section>

      <section className="audit-section page-shell" aria-labelledby="audit-title">
        <h2 className="sr-only" id="audit-title">Retrieval audit</h2>
        <details>
          <summary>Retrieval audit</summary>

          <div className="audit-grid">
            <div className="audit-block audit-overview">
              <span className="audit-label">Persistence</span>
              <strong>{persistence === "mongodb" ? "MongoDB Atlas" : "Deterministic fixture"}</strong>
              <p>
                {latestAudit?.retrieval.mode === "atlas-vector"
                  ? "Atlas Vector Search · context_vector_v1"
                  : latestAudit?.retrieval.mode === "mongodb-cosine-fallback"
                    ? "MongoDB durable store · cosine fallback while index builds"
                    : "Fixed demo packet · same repository contract"}
              </p>
            </div>

            <div className="audit-block">
              <span className="audit-label">Fixed security scope</span>
              <dl className="scope-list">
                <div><dt>workspaceId</dt><dd><code>demo_fund</code></dd></div>
                <div><dt>dealId</dt><dd><code>deal_irregular</code></dd></div>
                <div><dt>active</dt><dd><code>true</code></dd></div>
              </dl>
            </div>

            <div className="audit-block audit-query">
              <span className="audit-label">Vector query</span>
              <code>net retention threshold revisit decision</code>
            </div>

            <div className="audit-block">
              <span className="audit-label">Run status</span>
              <strong className={`run-status run-${latestRun?.status ?? "idle"}`}>
                {latestRun?.status ?? "not run"}
              </strong>
              <p>Run ID: <code>{latestRun?.id ?? "created on run"}</code></p>
            </div>

            <div className="audit-block audit-checkpoint">
              <span className="audit-label">Retrieval audit / checkpoint</span>
              <strong><code>{latestAudit?.id ?? "created atomically on retrieval"}</code></strong>
              <p>Checkpoint: <code>{latestAudit?.checkpoint.id ?? "awaiting run"}</code></p>
              {latestAudit?.packetHash ? <p>Packet hash: <code>{latestAudit.packetHash.slice(0, 16)}…</code></p> : null}
            </div>

            <div className="audit-block audit-contexts">
              <span className="audit-label">Selected context</span>
              {latestAudit?.candidates.length ? (
                <ol>
                  {latestAudit.candidates.map((candidate) => (
                    <li key={candidate.id}>
                      <div>
                        <code>{candidate.id}</code>
                        <span>{candidate.text}</span>
                      </div>
                      <strong>{Number.isFinite(candidate.score) ? candidate.score.toFixed(3) : "—"}</strong>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>Run the loop to record selected context IDs and similarity scores.</p>
              )}
            </div>
          </div>

          <p className="privacy-note">
            <span aria-hidden="true">◉</span>
            Credentials and prompts are never exposed. This receipt shows only scoped filters,
            selected evidence IDs, scores, hashes, and run state.
          </p>
        </details>
      </section>

      <footer className="footer page-shell">
        <p><span>VSee</span> Persistent context for accountable agents.</p>
        <p>Built on MongoDB Atlas · Synthetic demonstration data</p>
      </footer>
    </main>
  );
}
