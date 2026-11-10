// Helpers for saving and listing transcript lines (segments).
// Every final line gets the next sequence number for that meeting.
import db from "../db.js";

/** Return all final transcript lines for a meeting, oldest first. */
export function listSegments(meetingId) {
  return db
    .prepare("SELECT * FROM segments WHERE meeting_id = ? ORDER BY seq ASC")
    .all(meetingId);
}

/**
 * Save one final transcript line and return the new row.
 * seq is assigned automatically: 1, 2, 3, …
 */
export function saveFinalSegment(meetingId, { text, speaker = "Speaker", source = "MANUAL" }) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  const next = db
    .prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM segments WHERE meeting_id = ?")
    .get(meetingId).seq;

  const info = db
    .prepare(
      `INSERT INTO segments (meeting_id, seq, speaker, text, source)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(meetingId, next, speaker || "Speaker", trimmed, source);

  return db.prepare("SELECT * FROM segments WHERE id = ?").get(info.lastInsertRowid);
}

/**
 * Turn a pasted / uploaded transcript into { speaker, text } rows.
 * Expected line format: "Name: sentence" (SPEC §11). Lines without a colon
 * are kept as speaker "Speaker".
 */
export function parseTranscriptText(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^([^:]+):\s*(.+)$/);
      if (m) return { speaker: m[1].trim(), text: m[2].trim() };
      return { speaker: "Speaker", text: line };
    });
}
