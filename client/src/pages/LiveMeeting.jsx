// Live Meeting — the main demo screen (SPEC §10.4).
// Left: transcript. Middle / right: placeholders until Steps 4 and 6.
// Input modes for this step: Type, Upload, Demo script (Microphone comes in Step 3).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { getSocket } from "../socket.js";
import StatusBadge from "../components/StatusBadge.jsx";
import TranscriptPanel from "../components/TranscriptPanel.jsx";

const INPUT_MODES = [
  { id: "TYPE", label: "Type" },
  { id: "UPLOAD", label: "Upload transcript" },
  { id: "DEMO", label: "Demo script" },
  // Microphone is wired in Step 3
  { id: "MIC", label: "Microphone (Step 3)", disabled: true },
];

function useLiveTimer(startedAt, live) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!live || !startedAt) {
      setSecs(0);
      return;
    }
    const start = new Date(
      startedAt.includes("T") ? startedAt : startedAt.replace(" ", "T") + "Z"
    ).getTime();
    const tick = () => setSecs(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt, live]);

  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function LiveMeeting() {
  const { id } = useParams();
  const meetingId = Number(id);

  const [meeting, setMeeting] = useState(null);
  const [segments, setSegments] = useState([]);
  const [interim, setInterim] = useState(null);
  const [inputMode, setInputMode] = useState("TYPE");
  const [typed, setTyped] = useState("");
  const [speaker, setSpeaker] = useState("Speaker");
  const [demoFiles, setDemoFiles] = useState([]);
  const [demoFile, setDemoFile] = useState("meeting2_followup.txt");
  const [demoSpeed, setDemoSpeed] = useState(1);
  const [demoPlaying, setDemoPlaying] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const isLive = meeting?.status === "LIVE";
  const timer = useLiveTimer(meeting?.started_at, isLive);

  const loadMeeting = useCallback(async () => {
    const data = await api.get(`/meetings/${meetingId}`);
    setMeeting(data);
    setSegments(data.transcript || []);
    setSpeaker((current) =>
      current === "Speaker" && data.participants?.length ? data.participants[0].name : current
    );
    return data;
  }, [meetingId]);

  useEffect(() => {
    let cancelled = false;
    setError("");

    (async () => {
      try {
        await loadMeeting();
        const files = await api.get("/meetings/demo-files");
        if (!cancelled) {
          setDemoFiles(files);
          if (files.includes("meeting2_followup.txt")) setDemoFile("meeting2_followup.txt");
          else if (files[0]) setDemoFile(files[0]);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();

    const socket = getSocket();

    socket.emit("meeting:join", { meetingId }, (ack) => {
      if (cancelled || !ack || ack.error) {
        if (ack?.error) setError(ack.error);
        return;
      }
      if (Array.isArray(ack.transcript)) setSegments(ack.transcript);
    });

    const onFinal = ({ segment }) => {
      setSegments((list) => {
        if (list.some((s) => s.id === segment.id)) return list;
        return [...list, segment];
      });
      setInterim(null);
    };
    const onInterim = (payload) => setInterim(payload);
    const onStatus = ({ status }) => {
      setMeeting((m) => (m ? { ...m, status } : m));
      if (status === "ENDED") setDemoPlaying(false);
    };
    const onAiStatus = (payload) => {
      if (payload?.message?.startsWith("Demo finished")) setDemoPlaying(false);
    };

    socket.on("transcript:final", onFinal);
    socket.on("transcript:interim", onInterim);
    socket.on("meeting:status", onStatus);
    socket.on("ai:status", onAiStatus);

    return () => {
      cancelled = true;
      socket.off("transcript:final", onFinal);
      socket.off("transcript:interim", onInterim);
      socket.off("meeting:status", onStatus);
      socket.off("ai:status", onAiStatus);
    };
  }, [meetingId, loadMeeting]);

  async function startMeeting() {
    setBusy(true);
    setError("");
    try {
      const data = await api.post(`/meetings/${meetingId}/start`);
      setMeeting(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function endMeeting() {
    setBusy(true);
    setError("");
    try {
      if (demoPlaying) await api.post(`/meetings/${meetingId}/demo/stop`);
      const data = await api.post(`/meetings/${meetingId}/end`);
      setMeeting(data);
      setDemoPlaying(false);
      setInterim(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function sendTypedLine(e) {
    e.preventDefault();
    const text = typed.trim();
    if (!text || !isLive) return;
    getSocket().emit("segment:final", {
      meetingId,
      text,
      speaker,
      source: "MANUAL",
    });
    setTyped("");
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !isLive) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/meetings/${meetingId}/upload`, form);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function playDemo() {
    setBusy(true);
    setError("");
    try {
      await api.post(`/meetings/${meetingId}/demo/play`, { file: demoFile, speed: demoSpeed });
      setDemoPlaying(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function stopDemo() {
    setBusy(true);
    try {
      await api.post(`/meetings/${meetingId}/demo/stop`);
      setDemoPlaying(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!meeting && !error) {
    return <div className="p-4 text-slate-500">Loading meeting…</div>;
  }
  if (!meeting) {
    return (
      <div className="space-y-3">
        <p className="text-red-600">{error}</p>
        <Link to="/meetings" className="text-indigo-600">
          ← Back to meetings
        </Link>
      </div>
    );
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-57px)] flex-col bg-slate-50">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <div className="min-w-0 flex-1">
          <Link to="/meetings" className="text-xs text-indigo-600">
            ← Meetings
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{meeting.title}</h1>
            <StatusBadge status={meeting.status} />
            {isLive && (
              <span className="font-mono text-sm text-red-600" title="Live timer">
                {timer}
              </span>
            )}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600">
          Input
          <select
            className="input w-auto"
            value={inputMode}
            onChange={(e) => setInputMode(e.target.value)}
            disabled={!isLive && meeting.status !== "SCHEDULED"}
          >
            {INPUT_MODES.map((m) => (
              <option key={m.id} value={m.id} disabled={m.disabled}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {meeting.status === "SCHEDULED" && (
          <button type="button" className="btn-primary" onClick={startMeeting} disabled={busy}>
            Start meeting
          </button>
        )}
        {isLive && (
          <button type="button" className="btn-danger" onClick={endMeeting} disabled={busy}>
            End meeting
          </button>
        )}
      </header>

      {error && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      {isLive && (
        <div className="border-b border-slate-200 bg-white px-4 py-3">
          {inputMode === "TYPE" && (
            <form onSubmit={sendTypedLine} className="flex flex-wrap items-center gap-2">
              <select
                className="input w-40"
                value={speaker}
                onChange={(e) => setSpeaker(e.target.value)}
                aria-label="Speaking as"
              >
                {(meeting.participants || []).map((p) => (
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
                <option value="Speaker">Speaker</option>
              </select>
              <input
                className="input min-w-[16rem] flex-1"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Type a line and press Enter"
              />
              <button className="btn-primary" type="submit" disabled={!typed.trim()}>
                Send
              </button>
            </form>
          )}

          {inputMode === "UPLOAD" && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={onUpload}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                Choose .txt or .docx
              </button>
              <span className="text-slate-500">Each line should look like: Name: sentence</span>
            </div>
          )}

          {inputMode === "DEMO" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select
                className="input w-auto"
                value={demoFile}
                onChange={(e) => setDemoFile(e.target.value)}
                disabled={demoPlaying}
              >
                {demoFiles.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-slate-600">
                Speed
                <select
                  className="input w-auto"
                  value={demoSpeed}
                  onChange={(e) => setDemoSpeed(Number(e.target.value))}
                  disabled={demoPlaying}
                >
                  <option value={0.5}>0.5×</option>
                  <option value={1}>1×</option>
                  <option value={2}>2×</option>
                  <option value={4}>4×</option>
                </select>
              </label>
              {!demoPlaying ? (
                <button type="button" className="btn-primary" onClick={playDemo} disabled={busy}>
                  Play demo
                </button>
              ) : (
                <button type="button" className="btn-secondary" onClick={stopDemo} disabled={busy}>
                  Stop demo
                </button>
              )}
              <span className="text-slate-500">Lines appear every 2.5s at 1× speed</span>
            </div>
          )}

          {inputMode === "MIC" && (
            <p className="text-sm text-slate-500">Microphone mode is built in Step 3.</p>
          )}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-3">
        <div className="min-h-0 lg:col-span-1">
          <TranscriptPanel segments={segments} interim={interim} />
        </div>

        <div className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-700">Extracted items</h2>
          <p className="mt-2 text-sm text-slate-500">
            Decisions, actions, blockers and questions appear here in Step 4 (AI extraction).
          </p>
        </div>

        <div className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-700">Alerts</h2>
          <p className="mt-2 text-sm text-slate-500">
            Conflict flags and recurring-blocker alerts appear here in Steps 6–7.
          </p>
        </div>
      </div>
    </div>
  );
}
