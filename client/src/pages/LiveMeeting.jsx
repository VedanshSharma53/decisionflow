// Live Meeting — the main demo screen (SPEC §10.4).
// Left: transcript. Middle / right: placeholders until Steps 4 and 6.
// Input modes: Type, Upload, Demo script, Microphone (SPEC §7).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useApp } from "../context.jsx";
import { getSocket } from "../socket.js";
import { createSpeechRecognizer, isSpeechSupported } from "../speech.js";
import StatusBadge from "../components/StatusBadge.jsx";
import TranscriptPanel from "../components/TranscriptPanel.jsx";

const INPUT_MODES = [
  { id: "TYPE", label: "Type" },
  { id: "UPLOAD", label: "Upload transcript" },
  { id: "DEMO", label: "Demo script" },
  { id: "MIC", label: "Microphone" },
];

// SPEC §6: throttle interim mic text to about 4 updates per second
const INTERIM_MIN_MS = 250;

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

function SpeakerSelect({ participants, value, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-600">
      Speaking as
      <select className="input w-40" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Speaking as">
        {(participants || []).map((p) => (
          <option key={p.id} value={p.name}>
            {p.name}
          </option>
        ))}
        <option value="Speaker">Speaker</option>
      </select>
    </label>
  );
}

export default function LiveMeeting() {
  const { id } = useParams();
  const meetingId = Number(id);
  const { user } = useApp();

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

  // Microphone state (SPEC §7)
  const [micOn, setMicOn] = useState(false);
  const [micPaused, setMicPaused] = useState(false);
  const [micListening, setMicListening] = useState(false);
  const [micLang, setMicLang] = useState("en-IN");
  const [micMessage, setMicMessage] = useState("");

  const fileRef = useRef(null);
  const recognizerRef = useRef(null);
  const lastInterimEmitRef = useRef(0);
  // Refs so speech callbacks always see the latest values without recreating the recognizer
  const meetingIdRef = useRef(meetingId);
  const speakerRef = useRef(speaker);
  meetingIdRef.current = meetingId;
  speakerRef.current = speaker;

  const isLive = meeting?.status === "LIVE";
  const timer = useLiveTimer(meeting?.started_at, isLive);
  const isHost = Boolean(user && meeting && user.id === meeting.host_user_id);
  const speechOk = isSpeechSupported();

  const stopMic = useCallback(() => {
    recognizerRef.current?.stop();
    setMicOn(false);
    setMicPaused(false);
    setMicListening(false);
    setInterim(null);
  }, []);

  // One recognizer for the life of this page
  useEffect(() => {
    const rec = createSpeechRecognizer({
      lang: micLang,
      onListeningChange: (listening) => setMicListening(listening),
      onError: (message) => {
        setMicMessage(message);
        // Hard failures: reset the Start mic button so the user can try again
        if (/permission|Chrome or Edge|speech service failed|No microphone|cannot access/i.test(message)) {
          setMicOn(false);
          setMicPaused(false);
          setMicListening(false);
        }
      },
      onInterim: (text) => {
        const payload = { text, speaker: speakerRef.current };
        // Show immediately on this browser; also push to the room (throttled)
        setInterim(payload);
        const now = Date.now();
        if (now - lastInterimEmitRef.current < INTERIM_MIN_MS) return;
        lastInterimEmitRef.current = now;
        getSocket().emit("segment:interim", {
          meetingId: meetingIdRef.current,
          text,
          speaker: speakerRef.current,
        });
      },
      onFinal: (text) => {
        setInterim(null);
        getSocket().emit("segment:final", {
          meetingId: meetingIdRef.current,
          text,
          speaker: speakerRef.current,
          source: "MIC",
        });
      },
    });
    recognizerRef.current = rec;
    return () => {
      rec.stop();
      recognizerRef.current = null;
    };
    // lang is applied via setLang below — create once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    recognizerRef.current?.setLang(micLang);
  }, [micLang]);

  // Leaving mic mode, or meeting no longer LIVE → stop recording
  useEffect(() => {
    if (inputMode !== "MIC" || !isLive) stopMic();
  }, [inputMode, isLive, stopMic]);

  const loadMeeting = useCallback(async () => {
    const data = await api.get(`/meetings/${meetingId}`);
    setMeeting(data);
    setSegments(data.transcript || []);
    setSpeaker((current) =>
      current === "Speaker" && data.participants?.length ? data.participants[0].name : current
    );
    return data;
  }, [meetingId]);

  // Initial load + Socket.IO join so a second tab sees the same live transcript
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
      if (status === "ENDED") {
        setDemoPlaying(false);
        stopMic();
      }
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
  }, [meetingId, loadMeeting, stopMic]);

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
      stopMic();
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

  async function startMic() {
    setMicMessage("");
    if (!speechOk) {
      setMicMessage("Please use Chrome or Edge for microphone input.");
      return;
    }
    if (!isHost) {
      setMicMessage("Only the host's browser records. You can watch the transcript here.");
      return;
    }
    // Must be localhost or https — Chrome blocks speech on plain http://IP addresses
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      setMicMessage("Open the app at http://localhost:5173 (not an IP address) so Chrome allows the microphone.");
      return;
    }
    setMicOn(true);
    setMicPaused(false);
    await recognizerRef.current?.start();
  }

  function pauseMic() {
    recognizerRef.current?.pause();
    setMicPaused(true);
  }

  function resumeMic() {
    setMicMessage("");
    recognizerRef.current?.resume();
    setMicPaused(false);
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
      {/* Header */}
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
            {micListening && <span className="mic-dot" title="Listening" aria-label="Listening" />}
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
              <option key={m.id} value={m.id}>
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

      {/* Input controls under the header */}
      {isLive && (
        <div className="border-b border-slate-200 bg-white px-4 py-3">
          {inputMode === "TYPE" && (
            <form onSubmit={sendTypedLine} className="flex flex-wrap items-center gap-2">
              <SpeakerSelect
                participants={meeting.participants}
                value={speaker}
                onChange={setSpeaker}
              />
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
            <div className="space-y-2">
              {!speechOk ? (
                <p className="text-sm text-amber-700">
                  Please use Chrome or Edge — this browser does not support the Web Speech API.
                </p>
              ) : !isHost ? (
                <p className="text-sm text-slate-600">
                  Only the host&apos;s browser records. You can watch the live transcript here.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <SpeakerSelect
                    participants={meeting.participants}
                    value={speaker}
                    onChange={setSpeaker}
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    Language
                    <select
                      className="input w-auto"
                      value={micLang}
                      onChange={(e) => setMicLang(e.target.value)}
                    >
                      <option value="en-IN">en-IN</option>
                      <option value="en-US">en-US</option>
                    </select>
                  </label>

                  {!micOn ? (
                    <button type="button" className="btn-primary" onClick={startMic}>
                      Start mic
                    </button>
                  ) : micPaused ? (
                    <button type="button" className="btn-primary" onClick={resumeMic}>
                      Resume
                    </button>
                  ) : (
                    <button type="button" className="btn-secondary" onClick={pauseMic}>
                      Pause
                    </button>
                  )}

                  {micOn && (
                    <button type="button" className="btn-secondary" onClick={stopMic}>
                      Stop mic
                    </button>
                  )}

                  {micListening && (
                    <span className="inline-flex items-center gap-2 text-sm font-medium text-red-600">
                      <span className="mic-dot" /> Listening…
                    </span>
                  )}
                  {micOn && micPaused && (
                    <span className="text-sm text-slate-500">Paused</span>
                  )}
                </div>
              )}
              {micMessage && <p className="text-sm text-red-600">{micMessage}</p>}
            </div>
          )}
        </div>
      )}

      {/* 3-column layout */}
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
