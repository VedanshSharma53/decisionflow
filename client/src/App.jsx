import { Navigate, Route, Routes } from "react-router-dom";
import { useApp } from "./context.jsx";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Projects from "./pages/Projects.jsx";
import Placeholder from "./pages/Placeholder.jsx";

// Pages that need a login are wrapped in <Protected>
function Protected({ children }) {
  const { user, loading } = useApp();
  if (loading) return <div className="p-10 text-slate-500">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        {/* Built in later steps (see docs/CURSOR_BUILD_GUIDE.md) */}
        <Route path="/meetings" element={<Placeholder title="Meetings" step={2} />} />
        <Route path="/decisions" element={<Placeholder title="Decisions" step={5} />} />
        <Route path="/actions" element={<Placeholder title="Action Items" step={5} />} />
        <Route path="/reviews" element={<Placeholder title="Review Queue" step={6} />} />
        <Route path="/insights" element={<Placeholder title="Insights" step={7} />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
