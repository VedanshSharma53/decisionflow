// Decisions list: search (FTS) + status / meeting filters (SPEC §10.6).
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../context.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

const STATUSES = ["ALL", "PROPOSED", "APPROVED", "MODIFIED", "SUPERSEDED", "REJECTED"];

export default function Decisions() {
  const { projectId, project } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [meetingId, setMeetingId] = useState("");
  const [meetings, setMeetings] = useState([]);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // Load meetings for the filter dropdown
  useEffect(() => {
    if (!projectId) {
      setMeetings([]);
      return;
    }
    api
      .get(`/meetings?projectId=${projectId}`)
      .then(setMeetings)
      .catch(() => setMeetings([]));
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ projectId: String(projectId) });
    if (q.trim()) params.set("q", q.trim());
    if (status !== "ALL") params.set("status", status);
    if (meetingId) params.set("meetingId", meetingId);

    api
      .get(`/decisions?${params}`)
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, q, status, meetingId]);

  if (!projectId) {
    return (
      <div className="card text-sm text-slate-500">
        Select or create a project first to browse decisions.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Decisions</h1>
          <p className="text-sm text-slate-500">{project?.name}</p>
        </div>
        <Link
          to={`/reports/decision-log?projectId=${projectId}`}
          className="btn-secondary"
        >
          Decision Log
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="decision-search">
            Search
          </label>
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="decision-search"
              className="input pl-9"
              placeholder='Try "launch"'
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="decision-status">
            Status
          </label>
          <select
            id="decision-status"
            className="input w-40"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "ALL" ? "All statuses" : s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="decision-meeting">
            Meeting
          </label>
          <select
            id="decision-meeting"
            className="input w-56"
            value={meetingId}
            onChange={(e) => setMeetingId(e.target.value)}
          >
            <option value="">All meetings</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card text-sm text-slate-500">
          {q || status !== "ALL" || meetingId
            ? "No decisions match these filters."
            : "No decisions yet. Run a live meeting or play a demo script to extract some."}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Meeting</th>
                <th className="px-4 py-3 font-medium">Topic</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Certainty</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => {
                const strike = d.status === "SUPERSEDED" || d.status === "REJECTED";
                return (
                  <tr
                    key={d.id}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => navigate(`/decisions/${d.id}`)}
                  >
                    <td className={`px-4 py-3 font-medium ${strike ? "text-slate-400 line-through" : "text-slate-800"}`}>
                      <Link to={`/decisions/${d.id}`} className="hover:text-indigo-700" onClick={(e) => e.stopPropagation()}>
                        {d.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{d.meeting_title || "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{d.topic || "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={d.certainty} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
