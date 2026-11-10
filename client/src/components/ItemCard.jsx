// One extracted item card for the Live Meeting middle column.
import { useEffect, useState } from "react";
import StatusBadge from "./StatusBadge.jsx";

export default function ItemCard({
  itemType,
  item,
  flash,
  onApprove,
  onReject,
  onEdit,
}) {
  const [flashing, setFlashing] = useState(Boolean(flash));

  useEffect(() => {
    if (!flash) return;
    setFlashing(true);
    const t = setTimeout(() => setFlashing(false), 1200);
    return () => clearTimeout(t);
  }, [flash, item?.id]);

  if (!item) return null;

  const title =
    itemType === "decision"
      ? item.title
      : itemType === "action"
        ? item.title
        : itemType === "blocker"
          ? item.description
          : item.question;

  const strike = item.status === "SUPERSEDED" || item.status === "REJECTED";

  return (
    <div
      className={`rounded-lg border p-3 text-sm transition ${
        flashing ? "item-flash border-indigo-300" : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className={`font-medium text-slate-800 ${strike ? "line-through text-slate-500" : ""}`}>
            {title}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {item.status && <StatusBadge status={item.status} />}
            {item.certainty && <StatusBadge status={item.certainty} />}
            {item.priority && itemType === "action" && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {item.priority}
              </span>
            )}
            {item.lowConfidence && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                low confidence
              </span>
            )}
            {itemType === "question" && item.resolved ? (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">resolved</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-2 space-y-1 text-xs text-slate-500">
        {item.owner && <div>Owner: <span className="font-medium text-slate-700">{item.owner}</span></div>}
        {item.raised_by && <div>Raised by: <span className="font-medium text-slate-700">{item.raised_by}</span></div>}
        {(item.deadline || item.deadline_text) && (
          <div>
            Deadline:{" "}
            <span className="font-medium text-slate-700">
              {item.deadline || item.deadline_text}
              {item.deadline && item.deadline_text ? ` (${item.deadline_text})` : ""}
            </span>
          </div>
        )}
        {item.source_quote && (
          <blockquote className="border-l-2 border-slate-200 pl-2 italic text-slate-500">
            “{item.source_quote}”
          </blockquote>
        )}
      </div>

      {itemType === "decision" && item.status === "PROPOSED" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn-primary !px-2.5 !py-1 text-xs" onClick={() => onApprove?.(item)}>
            Approve
          </button>
          <button type="button" className="btn-danger !px-2.5 !py-1 text-xs" onClick={() => onReject?.(item)}>
            Reject
          </button>
          <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => onEdit?.(item)}>
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
