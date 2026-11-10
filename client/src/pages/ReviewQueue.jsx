// All PENDING relation flags for the current project (SPEC §10.8).
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { useApp } from "../context.jsx";
import ReviewCard from "../components/ReviewCard.jsx";

export default function ReviewQueue() {
  const { projectId, project, refreshPendingReviews } = useApp();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!projectId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const list = await api.get(`/relations?projectId=${projectId}&status=PENDING`);
      setRows(list);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  function onReviewed(result) {
    setRows((prev) => prev.filter((r) => r.id !== result.relation?.id));
    refreshPendingReviews?.();
  }

  if (!projectId) {
    return (
      <div className="card text-sm text-slate-500">
        Select a project to see pending review flags.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Review Queue</h1>
        <p className="text-sm text-slate-500">
          {project?.name} · {rows.length} pending
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card text-sm text-slate-500">
          No pending flags. Run a follow-up meeting (e.g. Sprint 2 demo) to create some.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <ReviewCard key={r.id} relation={r} onReviewed={onReviewed} />
          ))}
        </div>
      )}
    </div>
  );
}
