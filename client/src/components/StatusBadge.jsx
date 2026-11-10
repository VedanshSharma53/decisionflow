// Coloured badge for a status. The same colours are used everywhere (docs/SPEC.md section 10).
const STYLES = {
  // decision statuses
  PROPOSED: "bg-amber-100 text-amber-800",
  APPROVED: "bg-green-100 text-green-800",
  MODIFIED: "bg-blue-100 text-blue-800",
  SUPERSEDED: "bg-slate-200 text-slate-600 line-through",
  REJECTED: "bg-red-100 text-red-700",
  // relation types
  CONFLICTS: "bg-red-600 text-white",
  SUPERSEDES: "bg-slate-700 text-white",
  MODIFIES: "bg-blue-600 text-white",
  DUPLICATE: "bg-slate-500 text-white",
  // action item statuses
  OPEN: "bg-sky-100 text-sky-800",
  IN_PROGRESS: "bg-indigo-100 text-indigo-800",
  DONE: "bg-green-100 text-green-800",
  BLOCKED: "bg-red-100 text-red-700",
  // meeting statuses
  SCHEDULED: "bg-slate-100 text-slate-700",
  LIVE: "bg-red-600 text-white",
  ENDED: "bg-slate-200 text-slate-600",
  // certainty
  AGREED: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  TENTATIVE: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
};

export default function StatusBadge({ status }) {
  if (!status) return null;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
        STYLES[status] || "bg-slate-100 text-slate-700"
      }`}
    >
      {status.replace("_", " ")}
    </span>
  );
}
