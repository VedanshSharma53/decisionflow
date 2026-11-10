// Home dashboard — stats, my actions, recent meetings, recurring blockers (SPEC §10.2).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useApp } from "../context.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

function StatCard({ label, value, to }) {
  const inner = (
    <div className="card transition hover:border-indigo-200">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold">{value}</div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function formatWhen(raw) {
  if (!raw) return "—";
  const d = new Date(String(raw).includes("T") ? raw : String(raw).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Dashboard() {
  const { user, project, projectId } = useApp();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(projectId));

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Hello, {user?.name}</h1>
        <p className="text-slate-500">
          {project ? (
            <>
              Project: <span className="font-medium text-slate-700">{project.name}</span>
            </>
          ) : (
            <>
              No project yet —{" "}
              <Link className="text-indigo-600" to="/projects">
                create one
              </Link>{" "}
              to start.
            </>
          )}
        </p>
      </div>

      {!projectId ? null : loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Open action items" value={data.stats.openActions} to="/actions" />
            <StatCard label="Overdue" value={data.stats.overdueActions} to="/actions" />
            <StatCard label="Pending reviews" value={data.stats.pendingReviews} to="/reviews" />
            <StatCard label="Decisions this week" value={data.stats.decisionsThisWeek} to="/decisions" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-700">Open action items</h2>
                <Link to="/actions" className="text-sm text-indigo-600">
                  View all
                </Link>
              </div>
              {data.myActionItems.length === 0 ? (
                <p className="text-sm text-slate-500">No open action items.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.myActionItems.map((a) => (
                    <li key={a.id} className={`flex items-start justify-between gap-3 py-2 ${a.overdue ? "text-red-700" : ""}`}>
                      <div>
                        <div className="font-medium">{a.title}</div>
                        <div className="text-xs text-slate-500">
                          {a.owner || "Unassigned"}
                          {a.deadline ? ` · ${a.deadline}` : ""}
                          {a.overdue ? " · overdue" : ""}
                        </div>
                      </div>
                      <StatusBadge status={a.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-700">Recent meetings</h2>
                <Link to="/meetings" className="text-sm text-indigo-600">
                  View all
                </Link>
              </div>
              {data.recentMeetings.length === 0 ? (
                <p className="text-sm text-slate-500">No meetings yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.recentMeetings.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                      <div>
                        <Link to={`/meetings/${m.id}`} className="font-medium text-indigo-700 hover:underline">
                          {m.title}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {formatWhen(m.scheduled_at || m.started_at || m.created_at)}
                          {` · ${m.decision_count} decisions`}
                        </div>
                      </div>
                      <StatusBadge status={m.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-slate-700">Recurring blockers</h2>
              <Link to="/insights" className="text-sm text-indigo-600">
                Insights
              </Link>
            </div>
            {data.recurringBlockers.length === 0 ? (
              <p className="text-sm text-slate-500">
                None yet. Raise the same blocker in a second meeting to see it here.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.recurringBlockers.map((g) => (
                  <li key={g.groupId} className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2">
                    <div className="font-medium text-slate-800">{g.description}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      Seen in {g.meetingCount} meetings: {g.meetings.map((m) => m.title).join(", ")}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
