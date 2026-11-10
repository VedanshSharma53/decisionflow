// The frame around every logged-in page: sidebar on the left, top bar with project switcher.
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  CheckSquare,
  FolderKanban,
  GitCompareArrows,
  LayoutDashboard,
  LineChart,
  LogOut,
  Scale,
  Video,
} from "lucide-react";
import { useApp } from "../context.jsx";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/meetings", label: "Meetings", icon: Video },
  { to: "/decisions", label: "Decisions", icon: Scale },
  { to: "/actions", label: "Action Items", icon: CheckSquare },
  { to: "/reviews", label: "Review Queue", icon: GitCompareArrows },
  { to: "/insights", label: "Insights", icon: LineChart },
  { to: "/projects", label: "Projects", icon: FolderKanban },
];

export default function Layout() {
  const { user, logout, projects, projectId, setProjectId } = useApp();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="no-print flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">D</div>
          <div>
            <div className="font-semibold leading-tight">DecisionFlow</div>
            <div className="text-xs text-slate-500">Meeting intelligence</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">Project</span>
            {projects.length > 0 ? (
              <select
                className="input w-64"
                value={projectId ?? ""}
                onChange={(e) => setProjectId(Number(e.target.value))}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <button className="btn-secondary" onClick={() => navigate("/projects")}>
                Create your first project
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-600">{user?.name}</span>
            <button
              className="btn-secondary"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              <LogOut size={16} /> Logout
            </button>
          </div>
        </header>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
