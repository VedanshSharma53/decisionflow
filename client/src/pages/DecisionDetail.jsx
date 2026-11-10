// One decision: description, quote, status timeline, decision chain, link to meeting (SPEC §10.6).
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "../api.js";
import StatusBadge from "../components/StatusBadge.jsx";

function formatWhen(raw) {
  if (!raw) return "—";
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Build an ordered "decision chain" from relations both ways
 * e.g. "15 Mar (SUPERSEDED) → 1 Apr (APPROVED)".
 */
function buildDecisionChain(current, relations) {
  if (!current) return [];
  const nodes = new Map();
  nodes.set(current.id, {
    id: current.id,
    title: current.title,
    status: current.status,
    meetingTitle: current.meeting?.title,
  });

  for (const r of relations || []) {
    nodes.set(r.old_decision_id, {
      id: r.old_decision_id,
      title: r.old_title,
      status: r.old_status,
      meetingTitle: r.old_meeting_title,
    });
    nodes.set(r.new_decision_id, {
      id: r.new_decision_id,
      title: r.new_title,
      status: r.new_status,
      meetingTitle: r.new_meeting_title,
    });
  }

  // Prefer following SUPERSEDES / MODIFIES edges (accepted or pending) older → newer
  const edges = (relations || []).filter((r) =>
    ["SUPERSEDES", "MODIFIES", "DUPLICATE", "CONFLICTS"].includes(r.type)
  );

  // Topological-ish: start from nodes that are never a "new" side, then walk
  const newIds = new Set(edges.map((e) => e.new_decision_id));
  const starts = [...nodes.keys()].filter((id) => !newIds.has(id));
  const orderedIds = [];
  const seen = new Set();

  function walk(id) {
    if (seen.has(id)) return;
    seen.add(id);
    orderedIds.push(id);
    const outs = edges
      .filter((e) => e.old_decision_id === id)
      .sort((a, b) => a.id - b.id);
    for (const e of outs) walk(e.new_decision_id);
  }

  for (const id of starts.length ? starts : [current.id]) walk(id);
  // Any leftover (cycles / isolates)
  for (const id of nodes.keys()) walk(id);

  return orderedIds.map((id) => nodes.get(id)).filter(Boolean);
}

export default function DecisionDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      setData(await api.get(`/decisions/${id}`));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  async function approve() {
    setBusy(true);
    try {
      await api.post(`/decisions/${id}/approve`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    const reason = window.prompt("Reason for rejecting this decision?", "Not agreed") || "";
    setBusy(true);
    try {
      await api.post(`/decisions/${id}/reject`, { reason });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const chain = useMemo(
    () => (data ? buildDecisionChain(data, data.relations) : []),
    [data]
  );

  if (error && !data) {
    return (
      <div className="space-y-4">
        <Link to="/decisions" className="inline-flex items-center gap-1 text-sm text-indigo-600">
          <ArrowLeft size={16} /> Back to decisions
        </Link>
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  const strike = data.status === "SUPERSEDED" || data.status === "REJECTED";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/decisions" className="inline-flex items-center gap-1 text-sm text-indigo-600">
            <ArrowLeft size={16} /> Back to decisions
          </Link>
          <h1 className={`mt-2 text-2xl font-semibold ${strike ? "text-slate-400 line-through" : ""}`}>
            {data.title}
          </h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={data.status} />
            <StatusBadge status={data.certainty} />
            {data.topic && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {data.topic}
              </span>
            )}
          </div>
        </div>
        {data.status === "PROPOSED" && (
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={approve}>
              Approve
            </button>
            <button type="button" className="btn-danger" disabled={busy} onClick={reject}>
              Reject
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card space-y-3 text-sm">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Description</div>
          <p className="mt-1 text-slate-700">{data.description || "—"}</p>
        </div>
        {data.source_quote && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Source quote</div>
            <blockquote className="mt-1 border-l-2 border-indigo-200 pl-3 italic text-slate-600">
              “{data.source_quote}”
            </blockquote>
          </div>
        )}
        {data.meeting && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Meeting</div>
            <Link to={`/meetings/${data.meeting.id}`} className="mt-1 inline-block font-medium text-indigo-700">
              {data.meeting.title}
            </Link>
            <span className="ml-2 text-slate-500">
              ({formatWhen(data.meeting.scheduled_at || data.meeting.started_at)})
            </span>
          </div>
        )}
        {data.owner && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Owner</div>
            <p className="mt-1">{data.owner}</p>
          </div>
        )}
      </div>

      {chain.length > 1 && (
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Decision chain</h2>
          <div className="flex flex-wrap items-center gap-2">
            {chain.map((node, i) => {
              const nodeStrike = node.status === "SUPERSEDED" || node.status === "REJECTED";
              return (
                <div key={node.id} className="flex items-center gap-2">
                  {i > 0 && <span className="text-slate-300">→</span>}
                  <Link
                    to={`/decisions/${node.id}`}
                    className={`rounded-lg border px-3 py-2 text-sm transition hover:border-indigo-300 ${
                      node.id === data.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <div className={`font-medium ${nodeStrike ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      {node.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={node.status} />
                      {node.meetingTitle && (
                        <span className="text-[11px] text-slate-400">{node.meetingTitle}</span>
                      )}
                    </div>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.relations?.length > 0 && (
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Related flags</h2>
          <ul className="space-y-2 text-sm">
            {data.relations.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <StatusBadge status={r.type} />
                <StatusBadge status={r.review_status} />
                <span className="text-slate-600">
                  #{r.old_decision_id} ↔ #{r.new_decision_id}
                </span>
                {r.explanation && <span className="text-xs text-slate-500">{r.explanation}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.sourceLines?.length > 0 && (
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Source transcript lines</h2>
          <ul className="space-y-2 text-sm">
            {data.sourceLines.map((s) => (
              <li key={s.id} className="rounded-lg bg-slate-50 px-3 py-2">
                <span className="font-semibold text-slate-800">{s.speaker}: </span>
                <span className="text-slate-600">{s.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2 className="mb-4 text-sm font-semibold text-slate-700">Status history</h2>
        {data.history?.length === 0 ? (
          <p className="text-sm text-slate-500">No status changes yet.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-slate-200 pl-5">
            {data.history.map((h) => (
              <li key={h.id} className="relative">
                <span className="absolute -left-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-indigo-500 ring-4 ring-white" />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {h.from_status ? (
                    <>
                      <StatusBadge status={h.from_status} />
                      <span className="text-slate-400">→</span>
                    </>
                  ) : null}
                  <StatusBadge status={h.to_status} />
                </div>
                <p className="mt-1 text-sm text-slate-600">{h.reason || "Status changed"}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {formatWhen(h.changed_at)}
                  {h.changed_by_name ? ` · ${h.changed_by_name}` : " · system"}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
