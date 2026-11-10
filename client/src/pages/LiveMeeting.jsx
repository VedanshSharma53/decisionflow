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
import ExtractedItemsPanel from "../components/ExtractedItemsPanel.jsx";
import ReviewCard from "../components/ReviewCard.jsx";
import RecurringBlockerCard from "../components/RecurringBlockerCard.jsx";

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
  const { user, refreshPendingReviews } = useApp();

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

  // Extracted items (Step 4)
  const [decisions, setDecisions] = useState([]);
  const [actionItems, setActionItems] = useState([]);
  const [blockers, setBlockers] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [flashIds, setFlashIds] = useState(() => new Set());
  const [aiState, setAiState] = useState("idle"); // processing | idle | error
  const [aiLatencyMs, setAiLatencyMs] = useState(null);
  const [toast, setToast] = useState("");
  const [editItem, setEditItem] = useState(null); // decision being edited
  const [editForm, setEditForm] = useState({ title: "", description: "", owner: "" });
  const [alerts, setAlerts] = useState([]); // pending relation flags for this meeting
  const [blockerAlerts, setBlockerAlerts] = useState([]); // recurring-blocker alerts

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

  function applyItems(data) {
    setDecisions(data.decisions || []);
    setActionItems(data.actionItems || []);
    setBlockers(data.blockers || []);
    setQuestions(data.questions || []);
    setAlerts(data.relations || []);
  }

  function upsertDecisionEverywhere(item) {
    if (!item) return;
    upsertItem(setDecisions, item);
  }

  function mergeAlertFromFlag({ relation, newDecision, oldDecision }) {
    if (!relation) return;
    const enriched = {
      ...relation,
      new_title: relation.new_title || newDecision?.title,
      new_status: relation.new_status || newDecision?.status,
      new_certainty: relation.new_certainty || newDecision?.certainty,
      new_meeting_id: relation.new_meeting_id || newDecision?.meeting_id,
      new_meeting_title: relation.new_meeting_title || meeting?.title,
      old_title: relation.old_title || oldDecision?.title,
      old_status: relation.old_status || oldDecision?.status,
      old_certainty: relation.old_certainty || oldDecision?.certainty,
      old_meeting_id: relation.old_meeting_id || oldDecision?.meeting_id,
      old_meeting_title: relation.old_meeting_title || oldDecision?.meeting_title,
      old_meeting_scheduled_at:
        relation.old_meeting_scheduled_at || oldDecision?.meeting_scheduled_at,
      old_meeting_started_at: relation.old_meeting_started_at || oldDecision?.meeting_started_at,
    };
    setAlerts((list) => {
      if (list.some((a) => a.id === enriched.id)) {
        return list.map((a) => (a.id === enriched.id ? { ...a, ...enriched } : a));
      }
      return [...list, enriched];
    });
  }

  function upsertItem(setter, item) {
    setter((list) => {
      const i = list.findIndex((x) => x.id === item.id);
      if (i === -1) return [...list, item];
      const next = list.slice();
      next[i] = item;
      return next;
    });
  }

  function flashKey(itemType, id) {
    return `${itemType}-${id}`;
  }

  function markFlash(itemType, id) {
    const key = flashKey(itemType, id);
    setFlashIds((prev) => new Set(prev).add(key));
    setTimeout(() => {
      setFlashIds((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }, 1300);
  }

  const loadMeeting = useCallback(async () => {
    const data = await api.get(`/meetings/${meetingId}`);
    setMeeting(data);
    setSegments(data.transcript || []);
    applyItems(data);
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
      if (payload?.state) setAiState(payload.state);
      if (payload?.latencyMs != null) setAiLatencyMs(payload.latencyMs);
      if (payload?.state === "error") {
        setToast(payload.message || "AI extraction failed — meeting continues");
        setTimeout(() => setToast(""), 5000);
      }
    };
    const onItemCreated = ({ itemType, item }) => {
      if (itemType === "decision") upsertItem(setDecisions, item);
      else if (itemType === "action") upsertItem(setActionItems, item);
      else if (itemType === "blocker") upsertItem(setBlockers, item);
      else if (itemType === "question") upsertItem(setQuestions, item);
      markFlash(itemType, item.id);
    };
    const onItemUpdated = ({ itemType, item }) => {
      if (itemType === "decision") upsertItem(setDecisions, item);
      else if (itemType === "action") upsertItem(setActionItems, item);
      else if (itemType === "blocker") upsertItem(setBlockers, item);
      else if (itemType === "question") upsertItem(setQuestions, item);
    };
    const onRelationFlagged = (payload) => {
      mergeAlertFromFlag(payload);
      refreshPendingReviews?.();
    };
    const onRelationReviewed = ({ relation, newDecision, oldDecision }) => {
      if (relation?.id) {
        setAlerts((list) => list.filter((a) => a.id !== relation.id));
      }
      upsertDecisionEverywhere(newDecision);
      upsertDecisionEverywhere(oldDecision);
      refreshPendingReviews?.();
    };
    const onBlockerRecurring = (payload) => {
      if (!payload?.blocker) return;
      setBlockerAlerts((list) => {
        if (list.some((a) => a.blocker?.id === payload.blocker.id)) return list;
        return [...list, payload];
      });
      // Also refresh the blockers list badge/card
      upsertItem(setBlockers, payload.blocker);
    };

    socket.on("transcript:final", onFinal);
    socket.on("transcript:interim", onInterim);
    socket.on("meeting:status", onStatus);
    socket.on("ai:status", onAiStatus);
    socket.on("item:created", onItemCreated);
    socket.on("item:updated", onItemUpdated);
    socket.on("relation:flagged", onRelationFlagged);
    socket.on("relation:reviewed", onRelationReviewed);
    socket.on("blocker:recurring", onBlockerRecurring);

    return () => {
      cancelled = true;
      socket.off("transcript:final", onFinal);
      socket.off("transcript:interim", onInterim);
      socket.off("meeting:status", onStatus);
      socket.off("ai:status", onAiStatus);
      socket.off("item:created", onItemCreated);
      socket.off("item:updated", onItemUpdated);
      socket.off("relation:flagged", onRelationFlagged);
      socket.off("relation:reviewed", onRelationReviewed);
      socket.off("blocker:recurring", onBlockerRecurring);
    };
  }, [meetingId, loadMeeting, stopMic, refreshPendingReviews]);

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

  async function approveDecision(item) {
    try {
      const updated = await api.post(`/decisions/${item.id}/approve`);
      upsertItem(setDecisions, updated);
    } catch (err) {
      setToast(err.message);
      setTimeout(() => setToast(""), 4000);
    }
  }

  async function rejectDecision(item) {
    try {
      const updated = await api.post(`/decisions/${item.id}/reject`, { reason: "Rejected in live meeting" });
      upsertItem(setDecisions, updated);
    } catch (err) {
      setToast(err.message);
      setTimeout(() => setToast(""), 4000);
    }
  }

  function openEdit(item) {
    setEditItem(item);
    setEditForm({
      title: item.title || "",
      description: item.description || "",
      owner: item.owner || "",
    });
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editItem) return;
    try {
      const updated = await api.patch(`/decisions/${editItem.id}`, editForm);
      upsertItem(setDecisions, updated);
      setEditItem(null);
    } catch (err) {
      setToast(err.message);
      setTimeout(() => setToast(""), 4000);
    }
  }

  async function approveAgreed() {
    try {
      const res = await api.post(`/meetings/${meetingId}/approve-agreed`);
      for (const d of res.decisions || []) upsertItem(setDecisions, d);
    } catch (err) {
      setToast(err.message);
      setTimeout(() => setToast(""), 4000);
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

        {aiState === "processing" && (
          <span className="text-sm font-medium text-indigo-600">AI processing…</span>
        )}
        {aiState !== "processing" && aiLatencyMs != null && (
          <span className="text-xs text-slate-400" title="Last extraction latency">
            AI {aiLatencyMs} ms
          </span>
        )}

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
        {meeting.status === "ENDED" && (
          <Link to={`/meetings/${meetingId}/report`} className="btn-primary">
            View report
          </Link>
        )}
      </header>

      {error && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}
      {toast && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{toast}</div>
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

        <div className="min-h-0">
          <ExtractedItemsPanel
            decisions={decisions}
            actionItems={actionItems}
            blockers={blockers}
            questions={questions}
            flashIds={flashIds}
            onApprove={approveDecision}
            onReject={rejectDecision}
            onEdit={openEdit}
            onApproveAgreed={approveAgreed}
          />
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="font-semibold text-slate-700">Alerts</h2>
            <span className="text-xs text-slate-400">
              {alerts.length + blockerAlerts.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {alerts.length === 0 && blockerAlerts.length === 0 ? (
              <p className="text-sm text-slate-500">
                No flags yet. Relation reviews and recurring blockers appear here.
              </p>
            ) : (
              <>
                {blockerAlerts.map((a) => (
                  <RecurringBlockerCard key={`b-${a.blocker?.id}`} alert={a} />
                ))}
                {alerts.map((r) => (
                  <ReviewCard
                    key={r.id}
                    relation={r}
                    onReviewed={({ relation, newDecision, oldDecision }) => {
                      setAlerts((list) => list.filter((a) => a.id !== relation?.id));
                      upsertDecisionEverywhere(newDecision);
                      upsertDecisionEverywhere(oldDecision);
                      refreshPendingReviews?.();
                    }}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <form onSubmit={saveEdit} className="card w-full max-w-md space-y-3">
            <h3 className="font-semibold">Edit decision</h3>
            <div>
              <label className="label">Title</label>
              <input
                className="input"
                value={editForm.title}
                onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea
                className="input min-h-24"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">Owner</label>
              <input
                className="input"
                value={editForm.owner}
                onChange={(e) => setEditForm((f) => ({ ...f, owner: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary">
                Save
              </button>
              <button type="button" className="btn-secondary" onClick={() => setEditItem(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
