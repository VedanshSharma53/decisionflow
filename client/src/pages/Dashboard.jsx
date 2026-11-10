// Home page. Step 7 fills these cards with real numbers from /api/insights.
import { Link } from "react-router-dom";
import { useApp } from "../context.jsx";

function StatCard({ label, value }) {
  return (
    <div className="card">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold">{value}</div>
    </div>
  );
}

export default function Dashboard() {
  const { user, project } = useApp();

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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Open action items" value="–" />
        <StatCard label="Overdue" value="–" />
        <StatCard label="Pending reviews" value="–" />
        <StatCard label="Decisions this week" value="–" />
      </div>

      <div className="card text-sm text-slate-500">
        Recent meetings, your action items and recurring blockers will appear here (built in Step 7).
      </div>
    </div>
  );
}
