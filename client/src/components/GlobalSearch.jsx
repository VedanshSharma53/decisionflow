// Top-bar project search — decisions, action items, transcript lines (Step 8).
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../context.jsx";
import StatusBadge from "./StatusBadge.jsx";

export default function GlobalSearch() {
  const { projectId } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const boxRef = useRef(null);
  const timerRef = useRef(null);

  // Close the dropdown when clicking outside
  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!projectId) {
      setResults(null);
      return;
    }
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults(null);
      setError("");
      return;
    }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const data = await api.get(
          `/search?projectId=${projectId}&q=${encodeURIComponent(trimmed)}`
        );
        setResults(data);
        setOpen(true);
      } catch (err) {
        setError(err.message);
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timerRef.current);
  }, [q, projectId]);

  if (!projectId) return null;

  const empty =
    results &&
    results.decisions.length === 0 &&
    results.actionItems.length === 0 &&
    results.segments.length === 0;

  function go(path) {
    setOpen(false);
    setQ("");
    navigate(path);
  }

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 max-w-md">
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          className="input pl-9"
          placeholder='Search decisions, actions, transcript…'
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results && setOpen(true)}
          aria-label="Global search"
        />
      </div>

      {open && (loading || error || results) && (
        <div className="absolute left-0 right-0 z-40 mt-1 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {loading && <p className="px-3 py-2 text-sm text-slate-500">Searching…</p>}
          {error && <p className="px-3 py-2 text-sm text-red-600">{error}</p>}
          {empty && <p className="px-3 py-2 text-sm text-slate-500">No matches for “{results.q}”.</p>}

          {results?.decisions?.length > 0 && (
            <Section title="Decisions">
              {results.decisions.map((d) => (
                <button
                  key={`d-${d.id}`}
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => go(`/decisions/${d.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">{d.title}</div>
                    <div className="truncate text-xs text-slate-500">{d.meeting_title}</div>
                  </div>
                  <StatusBadge status={d.status} />
                </button>
              ))}
            </Section>
          )}

          {results?.actionItems?.length > 0 && (
            <Section title="Action items">
              {results.actionItems.map((a) => (
                <button
                  key={`a-${a.id}`}
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => go("/actions")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-800">{a.title}</div>
                    <div className="truncate text-xs text-slate-500">
                      {a.owner || "Unassigned"} · {a.meeting_title}
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </button>
              ))}
            </Section>
          )}

          {results?.segments?.length > 0 && (
            <Section title="Transcript">
              {results.segments.map((s) => (
                <button
                  key={`s-${s.id}`}
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => go(`/meetings/${s.meeting_id}`)}
                >
                  <div className="truncate text-xs text-slate-500">{s.meeting_title}</div>
                  <div className="truncate text-slate-700">
                    <span className="font-semibold">{s.speaker}: </span>
                    {s.text}
                  </div>
                </button>
              ))}
            </Section>
          )}

          <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400">
            Tip: also try the Decisions page search for status filters.{" "}
            <Link to="/decisions" className="text-indigo-600" onClick={() => setOpen(false)}>
              Open Decisions
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="border-b border-slate-100 py-1">
      <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </div>
      {children}
    </div>
  );
}
