// Left column of Live Meeting: scrolling transcript.
// Final lines are permanent; interim (partial mic text) shows in grey italics.
import { useEffect, useRef } from "react";

export default function TranscriptPanel({ segments, interim }) {
  const bottomRef = useRef(null);

  // Auto-scroll whenever a new line (or interim text) arrives
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [segments, interim]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold text-slate-700">
        Transcript
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {segments.length === 0 && !interim && (
          <p className="text-slate-400">Waiting for the first line…</p>
        )}
        {segments.map((s) => (
          <div key={s.id} className="leading-relaxed">
            <span className="font-bold text-slate-800">{s.speaker || "Speaker"}:</span>{" "}
            <span className="text-slate-700">{s.text}</span>
          </div>
        ))}
        {interim?.text ? (
          <div className="leading-relaxed italic text-slate-400">
            <span className="font-bold">{interim.speaker || "Speaker"}:</span> {interim.text}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
