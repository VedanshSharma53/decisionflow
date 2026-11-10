import { Navigate, Route, Routes } from "react-router-dom";
import { useApp } from "./context.jsx";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Projects from "./pages/Projects.jsx";
import Meetings from "./pages/Meetings.jsx";
import NewMeeting from "./pages/NewMeeting.jsx";
import LiveMeeting from "./pages/LiveMeeting.jsx";
import Decisions from "./pages/Decisions.jsx";
import DecisionDetail from "./pages/DecisionDetail.jsx";
import ActionItems from "./pages/ActionItems.jsx";
import ReviewQueue from "./pages/ReviewQueue.jsx";
import Insights from "./pages/Insights.jsx";
import MeetingReport from "./pages/MeetingReport.jsx";
import TemplateReport from "./pages/TemplateReport.jsx";

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
        <Route path="/meetings" element={<Meetings />} />
        <Route path="/meetings/new" element={<NewMeeting />} />
        <Route path="/meetings/:id" element={<LiveMeeting />} />
        <Route path="/meetings/:id/report" element={<MeetingReport />} />
        <Route path="/decisions" element={<Decisions />} />
        <Route path="/decisions/:id" element={<DecisionDetail />} />
        <Route path="/actions" element={<ActionItems />} />
        <Route path="/reviews" element={<ReviewQueue />} />
        <Route path="/insights" element={<Insights />} />
        <Route path="/reports/decision-log" element={<TemplateReport kind="decision-log" />} />
        <Route path="/reports/actions" element={<TemplateReport kind="actions" />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
