// Action items table with owner / status / overdue filters and inline status edits (SPEC §10.7).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useApp } from "../context.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

const STATUSES = ["ALL", "OPEN", "IN_PROGRESS", "DONE", "BLOCKED"];

export default function ActionItems() {
  const { projectId, project } = useApp();
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("ALL");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [rows, setRows] = useState([]);
  const [allOwners, setAllOwners] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  // Owner dropdown stays stable even when other filters hide some rows
  useEffect(() => {
    if (!projectId) {
      setAllOwners([]);
      return;
    }
    api
      .get(`/actions?projectId=${projectId}`)
      .then((list) => {
        const set = new Set();
        for (const r of list) if (r.owner) set.add(r.owner);
        setAllOwners([...set].sort());
      })
      .catch(() => setAllOwners([]));
  }, [projectId]);

  async function load() {
    if (!projectId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ projectId: String(projectId) });
    if (owner) params.set("owner", owner);
    if (status !== "ALL") params.set("status", status);
    if (overdueOnly) params.set("overdue", "1");
    try {
      setRows(await api.get(`/actions?${params}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [projectId, owner, status, overdueOnly]);

  const ownerOptions = useMemo(() => {
    const set = new Set(allOwners);
    if (owner) set.add(owner);
    return [...set].sort();
  }, [allOwners, owner]);

  async function changeStatus(row, nextStatus) {
    if (nextStatus === row.status) return;
    setSavingId(row.id);
    setError("");
    try {
      const updated = await api.patch(`/actions/${row.id}`, { status: nextStatus });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...updated } : r)));
      // If overdue filter is on and we marked DONE, drop it from the list
      if (overdueOnly && updated.status === "DONE") {
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingId(null);
    }
  }

  if (!projectId) {
    return (
      <div className="card text-sm text-slate-500">
        Select or create a project first to browse action items.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Action Items</h1>
          <p className="text-sm text-slate-500">{project?.name}</p>
        </div>
        <Link to={`/reports/actions?projectId=${projectId}`} className="btn-secondary">
          Action Item Report
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="action-owner">
            Owner
          </label>
          <select
            id="action-owner"
            className="input w-40"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
          >
            <option value="">All owners</option>
            {ownerOptions.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="action-status">
            Status
          </label>
          <select
            id="action-status"
            className="input w-40"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "ALL" ? "All statuses" : s.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Overdue only
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="card text-sm text-slate-500">
          {owner || status !== "ALL" || overdueOnly
            ? "No action items match these filters."
            : "No action items yet. They appear when the AI (or mock mode) extracts commitments from the transcript."}
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Owner</th>
                <th className="px-4 py-3 font-medium">Deadline</th>
                <th className="px-4 py-3 font-medium">Meeting</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.id} className={a.overdue ? "bg-red-50" : "hover:bg-slate-50"}>
                  <td className="px-4 py-3">
                    <div className={`font-medium ${a.overdue ? "text-red-800" : "text-slate-800"}`}>
                      {a.title}
                    </div>
                    {a.source_quote && (
                      <div className="mt-0.5 text-xs italic text-slate-500">“{a.source_quote}”</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{a.owner || "—"}</td>
                  <td className={`px-4 py-3 ${a.overdue ? "font-medium text-red-700" : "text-slate-600"}`}>
                    {a.deadline || a.deadline_text || "—"}
                    {a.overdue && <span className="ml-1 text-xs">overdue</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{a.meeting_title || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={a.status} />
                      <select
                        className="input !w-auto !py-1 text-xs"
                        value={a.status}
                        disabled={savingId === a.id}
                        onChange={(e) => changeStatus(a, e.target.value)}
                        aria-label={`Change status for ${a.title}`}
                      >
                        {STATUSES.filter((s) => s !== "ALL").map((s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                    </div>
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
