// Meeting summary report — react-markdown + Print / Save as PDF + Download .md (SPEC §10.5).
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import { ArrowLeft, Download, Printer, RefreshCw } from "lucide-react";
import { api } from "../api.js";
import StatusBadge from "../components/StatusBadge.jsx";

export default function MeetingReport() {
  const { id } = useParams();
  const meetingId = Number(id);
  const [meeting, setMeeting] = useState(null);
  const [summary, setSummary] = useState("");
  const [createdAt, setCreatedAt] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError("");
    try {
      const m = await api.get(`/meetings/${meetingId}`);
      setMeeting(m);
      try {
        const r = await api.get(`/meetings/${meetingId}/report`);
        setSummary(r.summary_md || "");
        setCreatedAt(r.created_at);
      } catch {
        setSummary("");
        setCreatedAt(null);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [meetingId]);

  async function regenerate() {
    setBusy(true);
    setError("");
    try {
      const r = await api.post(`/meetings/${meetingId}/report/regenerate`);
      setSummary(r.summary_md || "");
      setCreatedAt(r.created_at);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function downloadMd() {
    const blob = new Blob([summary || ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(meeting?.title || "meeting").replace(/\s+/g, "-").toLowerCase()}-report.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!meeting && !error) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error && !meeting) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to={`/meetings/${meetingId}`}
            className="inline-flex items-center gap-1 text-sm text-indigo-600"
          >
            <ArrowLeft size={16} /> Back to meeting
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{meeting.title} — Report</h1>
          {createdAt && (
            <p className="text-sm text-slate-500">Generated {createdAt}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print / Save as PDF
          </button>
          <button type="button" className="btn-secondary" onClick={downloadMd} disabled={!summary}>
            <Download size={16} /> Download .md
          </button>
          <button type="button" className="btn-primary" onClick={regenerate} disabled={busy}>
            <RefreshCw size={16} /> Regenerate
          </button>
        </div>
      </div>

      {error && <p className="no-print text-sm text-red-600">{error}</p>}

      <div className="card prose prose-slate max-w-none text-sm">
        {summary ? (
          <Markdown>{summary}</Markdown>
        ) : (
          <p className="text-slate-500">
            No report yet.{" "}
            <button type="button" className="text-indigo-600" onClick={regenerate}>
              Generate one
            </button>
            .
          </p>
        )}
      </div>

      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-slate-700">Extracted items</h2>
        <Section title="Decisions" items={meeting.decisions} render={(d) => (
          <span className="flex flex-wrap items-center gap-2">
            <span>{d.title}</span>
            <StatusBadge status={d.status} />
          </span>
        )} />
        <Section title="Action items" items={meeting.actionItems} render={(a) => (
          <span>
            {a.title}
            {a.owner ? ` · ${a.owner}` : ""}
            {a.deadline ? ` · ${a.deadline}` : ""} — {a.status}
          </span>
        )} />
        <Section title="Blockers" items={meeting.blockers} render={(b) => b.description} />
        <Section title="Questions" items={meeting.questions} render={(q) => q.question} />
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Transcript</h2>
        <ul className="space-y-2 text-sm">
          {(meeting.transcript || []).map((s) => (
            <li key={s.id}>
              <span className="font-semibold">{s.speaker}: </span>
              <span className="text-slate-600">{s.text}</span>
            </li>
          ))}
          {(meeting.transcript || []).length === 0 && (
            <li className="text-slate-500">No transcript lines.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function Section({ title, items, render }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {(items || []).length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">None</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {items.map((item) => (
            <li key={item.id}>{render(item)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
