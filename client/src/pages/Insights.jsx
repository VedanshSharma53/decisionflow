// Project insights with Recharts (SPEC §10.9).
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api.js";
import { useApp } from "../context.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

const PIE_COLORS = {
  PROPOSED: "#f59e0b",
  APPROVED: "#22c55e",
  MODIFIED: "#3b82f6",
  SUPERSEDED: "#94a3b8",
  REJECTED: "#ef4444",
};

export default function Insights() {
  const { projectId, project } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    api
      .get(`/insights/project/${projectId}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (!projectId) {
    return <div className="card text-sm text-slate-500">Select a project to see insights.</div>;
  }
  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return null;

  const { stats, actionsPerOwner, decisionStatuses, decisionsPerMeeting, recurringBlockers } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-sm text-slate-500">{project?.name}</p>
      </div>

      <div className="card">
        <div className="text-sm text-slate-500">Accountability score</div>
        <div className="mt-1 flex items-end gap-3">
          <div className="text-4xl font-semibold text-indigo-700">{stats.accountabilityScore}%</div>
          <p className="pb-1 text-sm text-slate-500">
            of action items have both an owner and a deadline
            ({stats.withOwnerAndDeadline}/{stats.totalActions})
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Actions per owner</h2>
          {actionsPerOwner.length === 0 ? (
            <p className="text-sm text-slate-500">No action items yet.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={actionsPerOwner}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="owner" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="open" stackId="a" fill="#38bdf8" name="Open" />
                  <Bar dataKey="overdue" stackId="a" fill="#ef4444" name="Overdue" />
                  <Bar dataKey="done" stackId="a" fill="#22c55e" name="Done" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Decision statuses</h2>
          {decisionStatuses.length === 0 ? (
            <p className="text-sm text-slate-500">No decisions yet.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={decisionStatuses}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ status, count }) => `${status} (${count})`}
                  >
                    {decisionStatuses.map((s) => (
                      <Cell key={s.status} fill={PIE_COLORS[s.status] || "#64748b"} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Decisions per meeting</h2>
        {decisionsPerMeeting.length === 0 ? (
          <p className="text-sm text-slate-500">No meetings yet.</p>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={decisionsPerMeeting}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="meetingTitle"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={60}
                />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={2} name="Decisions" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Recurring blockers</h2>
        {recurringBlockers.length === 0 ? (
          <p className="text-sm text-slate-500">
            None yet. The same blocker raised in two meetings will appear here.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium">Meetings</th>
                  <th className="px-3 py-2 font-medium">Mentions</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recurringBlockers.map((g) => (
                  <tr key={g.groupId}>
                    <td className="px-3 py-2">{g.description}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {g.meetings.map((m) => m.title).join(", ")}
                    </td>
                    <td className="px-3 py-2">{g.mentionCount}</td>
                    <td className="px-3 py-2">
                      {g.resolved ? (
                        <StatusBadge status="DONE" />
                      ) : (
                        <span className="text-xs font-medium text-amber-700">Open</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
