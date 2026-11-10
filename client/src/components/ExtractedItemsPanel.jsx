// Middle column of Live Meeting: Decisions / Actions / Blockers / Questions tabs.
import { useMemo, useState } from "react";
import ItemCard from "./ItemCard.jsx";

const TABS = [
  { id: "decisions", label: "Decisions", type: "decision" },
  { id: "actions", label: "Actions", type: "action" },
  { id: "blockers", label: "Blockers", type: "blocker" },
  { id: "questions", label: "Questions", type: "question" },
];

export default function ExtractedItemsPanel({
  decisions,
  actionItems,
  blockers,
  questions,
  flashIds,
  onApprove,
  onReject,
  onEdit,
  onApproveAgreed,
}) {
  const [tab, setTab] = useState("decisions");

  const counts = {
    decisions: decisions.length,
    actions: actionItems.length,
    blockers: blockers.length,
    questions: questions.length,
  };

  const list = useMemo(() => {
    if (tab === "decisions") return decisions.map((item) => ({ itemType: "decision", item }));
    if (tab === "actions") return actionItems.map((item) => ({ itemType: "action", item }));
    if (tab === "blockers") return blockers.map((item) => ({ itemType: "blocker", item }));
    return questions.map((item) => ({ itemType: "question", item }));
  }, [tab, decisions, actionItems, blockers, questions]);

  const proposedAgreed = decisions.filter((d) => d.status === "PROPOSED" && d.certainty === "AGREED");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-700">Extracted items</h2>
        {proposedAgreed.length > 0 && (
          <button
            type="button"
            className="btn-secondary !px-2 !py-1 text-xs"
            onClick={onApproveAgreed}
            title="Approve all PROPOSED decisions marked AGREED"
          >
            Approve all AGREED
          </button>
        )}
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
              tab === t.id ? "bg-indigo-50 text-indigo-700" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {t.label}{" "}
            <span className="text-slate-400">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {list.length === 0 ? (
          <p className="text-sm text-slate-400">Nothing extracted yet — keep the transcript flowing.</p>
        ) : (
          list.map(({ itemType, item }) => (
            <ItemCard
              key={`${itemType}-${item.id}`}
              itemType={itemType}
              item={item}
              flash={flashIds?.has?.(`${itemType}-${item.id}`)}
              onApprove={onApprove}
              onReject={onReject}
              onEdit={onEdit}
            />
          ))
        )}
      </div>
    </div>
  );
}
