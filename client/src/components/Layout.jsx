// The frame around every logged-in page: sidebar on the left, top bar with project switcher + search.
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
import GlobalSearch from "./GlobalSearch.jsx";

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
  const { user, logout, projects, projectId, setProjectId, pendingReviewCount } = useApp();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen min-w-0">
      {/* Sidebar — slightly narrower so a 1366×768 laptop still has room for content */}
      <aside className="no-print flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white lg:w-56">
        <div className="flex items-center gap-2 px-4 py-4 lg:px-5 lg:py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 font-bold text-white">
            D
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold leading-tight">DecisionFlow</div>
            <div className="truncate text-xs text-slate-500">Meeting intelligence</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 lg:px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm font-medium lg:gap-3 lg:px-3 ${
                  isActive ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              <span className="flex min-w-0 items-center gap-2 lg:gap-3">
                <Icon size={18} className="shrink-0" />
                <span className="truncate">{label}</span>
              </span>
              {to === "/reviews" && pendingReviewCount > 0 && (
                <span className="shrink-0 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {pendingReviewCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:gap-4 lg:px-6">
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-slate-500 sm:inline">Project</span>
            {projects.length > 0 ? (
              <select
                className="input w-40 sm:w-52 lg:w-56"
                value={projectId ?? ""}
                onChange={(e) => setProjectId(Number(e.target.value))}
                aria-label="Current project"
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

          <GlobalSearch />

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden truncate text-sm text-slate-600 sm:inline">{user?.name}</span>
            <button
              className="btn-secondary"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              <LogOut size={16} /> <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
