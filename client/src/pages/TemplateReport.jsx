// Template-only reports: Decision Log and Action Item Report (SPEC §8.5).
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Markdown from "react-markdown";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../context.jsx";

const KINDS = {
  "decision-log": {
    title: "Decision Log",
    path: (projectId) => `/reports/decision-log?projectId=${projectId}`,
    backTo: "/decisions",
    backLabel: "Back to decisions",
    filename: "decision-log.md",
  },
  actions: {
    title: "Action Item Report",
    path: (projectId) => `/reports/actions?projectId=${projectId}`,
    backTo: "/actions",
    backLabel: "Back to action items",
    filename: "action-items.md",
  },
};

export default function TemplateReport({ kind }) {
  const meta = KINDS[kind];
  const { projectId, project } = useApp();
  const [searchParams] = useSearchParams();
  const pid = Number(searchParams.get("projectId")) || projectId;
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!pid || !meta) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    api
      .get(meta.path(pid))
      .then((r) => setMarkdown(r.markdown || ""))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [pid, meta]);

  function downloadMd() {
    const blob = new Blob([markdown || ""], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = meta.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!meta) return <p className="text-sm text-red-600">Unknown report.</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={meta.backTo} className="inline-flex items-center gap-1 text-sm text-indigo-600">
            <ArrowLeft size={16} /> {meta.backLabel}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{meta.title}</h1>
          <p className="text-sm text-slate-500">{project?.name}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={() => window.print()}>
            <Printer size={16} /> Print / Save as PDF
          </button>
          <button type="button" className="btn-secondary" onClick={downloadMd} disabled={!markdown}>
            <Download size={16} /> Download .md
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="card prose prose-slate max-w-none text-sm">
          <Markdown>{markdown}</Markdown>
        </div>
      )}
    </div>
  );
}
