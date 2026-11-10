// One pending relation flag for human review (SPEC §10.4 / §10.8).
import { useState } from "react";
import { api } from "../api.js";
import StatusBadge from "./StatusBadge.jsx";

function formatWhen(raw) {
  if (!raw) return "";
  const d = new Date(raw.includes("T") ? raw : String(raw).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function DecisionSide({ label, title, status, meetingTitle, meetingWhen, certainty }) {
  const strike = status === "SUPERSEDED" || status === "REJECTED";
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-slate-50 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-sm font-medium ${strike ? "text-slate-400 line-through" : "text-slate-800"}`}>
        {title}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <StatusBadge status={status} />
        {certainty && <StatusBadge status={certainty} />}
      </div>
      {(meetingTitle || meetingWhen) && (
        <div className="mt-1.5 text-xs text-slate-500">
          {meetingTitle}
          {meetingWhen ? ` · ${formatWhen(meetingWhen)}` : ""}
        </div>
      )}
    </div>
  );
}

/** Review card for one relation flag. relation includes new_/old_ fields from the API. */
export default function ReviewCard({ relation, onReviewed }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!relation) return null;

  const changes = Array.isArray(relation.changed_fields) ? relation.changed_fields : [];
  const isConflict = relation.type === "CONFLICTS";
  const pending = relation.review_status === "PENDING";

  async function submit(action, resolution = null) {
    setBusy(true);
    setError("");
    try {
      const body = { action, note: note.trim() || undefined };
      if (resolution) body.resolution = resolution;
      const result = await api.post(`/relations/${relation.id}/review`, body);
      onReviewed?.(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        relation.type === "CONFLICTS" ? "border-red-300 bg-red-50/40" : "border-slate-200 bg-white"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StatusBadge status={relation.type} />
        {relation.confidence != null && (
          <span className="text-xs text-slate-500">
            confidence {(Number(relation.confidence) * 100).toFixed(0)}%
          </span>
        )}
        {!pending && <StatusBadge status={relation.review_status} />}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <DecisionSide
          label="Earlier decision"
          title={relation.old_title}
          status={relation.old_status}
          certainty={relation.old_certainty}
          meetingTitle={relation.old_meeting_title}
          meetingWhen={relation.old_meeting_scheduled_at || relation.old_meeting_started_at}
        />
        <DecisionSide
          label="New decision"
          title={relation.new_title}
          status={relation.new_status}
          certainty={relation.new_certainty}
          meetingTitle={relation.new_meeting_title}
          meetingWhen={relation.new_meeting_scheduled_at || relation.new_meeting_started_at}
        />
      </div>

      {relation.explanation && (
        <p className="mt-3 text-sm text-slate-600">{relation.explanation}</p>
      )}

      {changes.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {changes.map((c, i) => (
            <li key={i} className="rounded bg-slate-100 px-2 py-1 font-mono">
              <span className="font-semibold text-slate-700">{c.field}</span>: {c.from} → {c.to}
            </li>
          ))}
        </ul>
      )}

      {pending && (
        <div className="mt-3 space-y-2">
          <input
            className="input text-xs"
            placeholder="Optional note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={busy}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {isConflict ? (
              <>
                <button
                  type="button"
                  className="btn-primary !px-2.5 !py-1 text-xs"
                  disabled={busy}
                  onClick={() => submit("ACCEPT", "KEEP_NEW")}
                >
                  Keep new
                </button>
                <button
                  type="button"
                  className="btn-secondary !px-2.5 !py-1 text-xs"
                  disabled={busy}
                  onClick={() => submit("ACCEPT", "KEEP_OLD")}
                >
                  Keep old
                </button>
                <button
                  type="button"
                  className="btn-secondary !px-2.5 !py-1 text-xs"
                  disabled={busy}
                  onClick={() => submit("ACCEPT", "KEEP_BOTH")}
                >
                  Keep both
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-primary !px-2.5 !py-1 text-xs"
                disabled={busy}
                onClick={() => submit("ACCEPT")}
              >
                Accept
              </button>
            )}
            <button
              type="button"
              className="btn-danger !px-2.5 !py-1 text-xs"
              disabled={busy}
              onClick={() => submit("REJECT")}
            >
              Reject flag
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
