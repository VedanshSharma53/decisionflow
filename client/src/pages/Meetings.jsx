// Meetings list with status tabs (SPEC §10.3).
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../context.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

const TABS = [
  { id: "ALL", label: "All" },
  { id: "SCHEDULED", label: "Scheduled" },
  { id: "LIVE", label: "Live" },
  { id: "ENDED", label: "Ended" },
];

function formatWhen(m) {
  const raw = m.scheduled_at || m.started_at || m.created_at;
  if (!raw) return "—";
  // SQLite datetime('now') is UTC without timezone; Date() still parses it reasonably
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

export default function Meetings() {
  const { projectId, project } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState("ALL");
  const [meetings, setMeetings] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) {
      setMeetings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const q = tab === "ALL" ? "" : `&status=${tab}`;
    api
      .get(`/meetings?projectId=${projectId}${q}`)
      .then(setMeetings)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, tab]);

  if (!projectId) {
    return (
      <div className="card text-sm text-slate-500">
        Select or create a project first, then add meetings.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Meetings</h1>
          <p className="text-sm text-slate-500">{project?.name}</p>
        </div>
        <Link to="/meetings/new" className="btn-primary">
          <Plus size={16} /> New meeting
        </Link>
      </div>

      <div className="flex gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : meetings.length === 0 ? (
        <div className="card text-sm text-slate-500">
          No meetings in this tab.{" "}
          <Link className="text-indigo-600" to="/meetings/new">
            Create one
          </Link>
          .
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">People</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {meetings.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{m.title}</td>
                  <td className="px-4 py-3 text-slate-600">{formatWhen(m)}</td>
                  <td className="px-4 py-3 text-slate-600">{m.participant_count}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={m.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => navigate(`/meetings/${m.id}`)}
                    >
                      {m.status === "ENDED" ? "Open" : "Join"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
