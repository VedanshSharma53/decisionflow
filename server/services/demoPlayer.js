// Plays a demo/*.txt file line by line into a LIVE meeting, as if people were speaking.
// Used for the project demo when the mic is unreliable (SPEC §7).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscriptText, saveFinalSegment } from "./segments.js";
import { emitToMeeting } from "./realtime.js";
import { onSegmentSaved } from "./extraction.js";
import { HttpError } from "../middleware/errors.js";

const DEMO_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "demo");

// One timer per meeting so we never play two demos at once in the same room
const players = new Map(); // meetingId → { timer, index, lines, file }

/** List the .txt demo scripts that the Live Meeting dropdown can offer. */
export function listDemoFiles() {
  if (!fs.existsSync(DEMO_DIR)) return [];
  return fs
    .readdirSync(DEMO_DIR)
    .filter((f) => f.endsWith(".txt"))
    .sort();
}

/** Resolve a demo filename safely (no path traversal). */
export function resolveDemoFile(file) {
  const name = path.basename(String(file || ""));
  if (!name.endsWith(".txt")) throw new HttpError(400, "Demo file must be a .txt");
  const full = path.join(DEMO_DIR, name);
  if (!fs.existsSync(full)) throw new HttpError(404, `Demo file not found: ${name}`);
  return { name, full };
}

/**
 * Start playing a demo file into a meeting.
 * speed = 1 → one line every 2.5 s; speed = 2 → twice as fast, etc.
 */
export function playDemo(meetingId, file, speed = 1) {
  stopDemo(meetingId);

  const { name, full } = resolveDemoFile(file);
  const lines = parseTranscriptText(fs.readFileSync(full, "utf8"));
  if (lines.length === 0) throw new HttpError(400, "Demo file is empty");

  const intervalMs = Math.max(400, 2500 / Math.max(0.25, Number(speed) || 1));
  const state = { index: 0, lines, file: name, timer: null };

  state.timer = setInterval(() => {
    if (state.index >= state.lines.length) {
      stopDemo(meetingId);
      emitToMeeting(meetingId, "ai:status", {
        state: "idle",
        message: `Demo finished: ${name}`,
      });
      return;
    }

    const line = state.lines[state.index++];
    const segment = saveFinalSegment(meetingId, {
      text: line.text,
      speaker: line.speaker,
      source: "DEMO",
    });
    if (segment) {
      emitToMeeting(meetingId, "transcript:final", { segment });
      onSegmentSaved(segment); // feed the AI extraction buffer
    }
  }, intervalMs);

  players.set(Number(meetingId), state);
  return { file: name, lines: lines.length, intervalMs };
}

/** Stop the demo for a meeting (safe to call if nothing is playing). */
export function stopDemo(meetingId) {
  const state = players.get(Number(meetingId));
  if (!state) return false;
  clearInterval(state.timer);
  players.delete(Number(meetingId));
  return true;
}

export function isDemoPlaying(meetingId) {
  return players.has(Number(meetingId));
}
