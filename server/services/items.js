// Helpers to load / shape extracted items for the API and sockets.
import db from "../db.js";

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function shapeDecision(row) {
  if (!row) return null;
  const confidence = row.confidence;
  return {
    ...row,
    keywords: parseJson(row.keywords, []),
    source_segment_ids: parseJson(row.source_segment_ids, []),
    lowConfidence: confidence != null && confidence < 0.7,
  };
}

export function shapeAction(row) {
  if (!row) return null;
  const confidence = row.confidence;
  return {
    ...row,
    source_segment_ids: parseJson(row.source_segment_ids, []),
    lowConfidence: confidence != null && confidence < 0.7,
  };
}

export function shapeBlocker(row) {
  if (!row) return null;
  return {
    ...row,
    keywords: parseJson(row.keywords, []),
  };
}

export function shapeQuestion(row) {
  return row || null;
}

export function listMeetingDecisions(meetingId) {
  return db
    .prepare("SELECT * FROM decisions WHERE meeting_id = ? ORDER BY id ASC")
    .all(meetingId)
    .map(shapeDecision);
}

export function listMeetingActions(meetingId) {
  return db
    .prepare("SELECT * FROM action_items WHERE meeting_id = ? ORDER BY id ASC")
    .all(meetingId)
    .map(shapeAction);
}

export function listMeetingBlockers(meetingId) {
  return db
    .prepare("SELECT * FROM blockers WHERE meeting_id = ? ORDER BY id ASC")
    .all(meetingId)
    .map(shapeBlocker);
}

export function listMeetingQuestions(meetingId) {
  return db
    .prepare("SELECT * FROM questions WHERE meeting_id = ? ORDER BY id ASC")
    .all(meetingId)
    .map(shapeQuestion);
}

/** Short list for the extraction prompt EXISTING_ITEMS section. */
export function listExistingItemsForPrompt(meetingId) {
  const items = [];
  for (const d of listMeetingDecisions(meetingId)) {
    items.push({ id: d.id, type: "decision", title: d.title });
  }
  for (const a of listMeetingActions(meetingId)) {
    items.push({ id: a.id, type: "action", title: a.title });
  }
  for (const b of listMeetingBlockers(meetingId)) {
    items.push({ id: b.id, type: "blocker", title: b.description });
  }
  for (const q of listMeetingQuestions(meetingId)) {
    items.push({ id: q.id, type: "question", title: q.question });
  }
  return items;
}
