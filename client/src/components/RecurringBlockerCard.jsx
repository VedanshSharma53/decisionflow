// Alert when a blocker was also raised in earlier meetings (SPEC §8.4 / §10.4).

function formatWhen(raw) {
  if (!raw) return "";
  const d = new Date(String(raw).includes("T") ? raw : String(raw).replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function RecurringBlockerCard({ alert }) {
  if (!alert) return null;
  const meetings = alert.previousMeetings || [];

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
        Recurring blocker
      </div>
      <p className="mt-1 font-medium text-slate-800">
        {alert.blocker?.description || alert.message}
      </p>
      {alert.message && (
        <p className="mt-1 text-xs text-amber-800">{alert.message}</p>
      )}
      {meetings.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {meetings.map((m) => (
            <li key={m.id}>
              Also in <span className="font-medium">{m.title}</span>
              {m.date ? ` · ${formatWhen(m.date)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
