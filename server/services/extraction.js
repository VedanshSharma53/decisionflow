// Live AI extraction (SPEC §8.2 + mock §8.6).
// Buffers new transcript lines per meeting and extracts decisions / actions / blockers / questions.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../db.js";
import { askClaude, isMockMode, logMockRun } from "./ai.js";
import { ExtractionSchema } from "./schemas.js";
import { emitToMeeting } from "./realtime.js";
import { check as checkConflicts } from "./conflicts.js";
import { checkRecurring } from "./blockers.js";
import { recordActionChange } from "./lifecycle.js";
import {
  listExistingItemsForPrompt,
  listMeetingActions,
  listMeetingBlockers,
  listMeetingDecisions,
  listMeetingQuestions,
  shapeAction,
  shapeBlocker,
  shapeDecision,
  shapeQuestion,
} from "./items.js";

const PROMPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prompts", "extraction.md");
const SYSTEM_PROMPT = fs.readFileSync(PROMPT_PATH, "utf8");

// meetingId → { newSegments, lastRunAt, running, processedIds }
const buffers = new Map();

function getBuffer(meetingId) {
  const id = Number(meetingId);
  if (!buffers.has(id)) {
    buffers.set(id, {
      newSegments: [],
      lastRunAt: Date.now(),
      running: false,
      processedIds: new Set(),
    });
  }
  return buffers.get(id);
}

/** Call this whenever a final segment is saved into a LIVE meeting. */
export function onSegmentSaved(segment) {
  if (!segment?.id) return;
  const buf = getBuffer(segment.meeting_id);
  if (buf.processedIds.has(segment.id)) return;
  if (buf.newSegments.some((s) => s.id === segment.id)) return;
  buf.newSegments.push(segment);
}

function participants(meetingId) {
  return db
    .prepare("SELECT name FROM participants WHERE meeting_id = ? ORDER BY id")
    .all(meetingId)
    .map((p) => p.name);
}

/** Match owner to a participant (case-insensitive, first-name match). Else keep raw. */
function matchOwner(raw, names) {
  if (!raw) return null;
  const needle = String(raw).trim().toLowerCase();
  if (!needle) return null;
  const exact = names.find((n) => n.toLowerCase() === needle);
  if (exact) return exact;
  const first = needle.split(/\s+/)[0];
  const byFirst = names.find((n) => n.toLowerCase().split(/\s+/)[0] === first);
  return byFirst || String(raw).trim();
}

function clipQuote(q) {
  const s = String(q || "").trim();
  return s.length > 200 ? s.slice(0, 200) : s;
}

function todayInTimezone() {
  const tz = process.env.TIMEZONE || "Asia/Kolkata";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()); // YYYY-MM-DD
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Format a local Date as YYYY-MM-DD (avoid toISOString UTC day-shift). */
function toYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLooseDeadline(text, baseDateStr) {
  if (!text) return null;
  const t = text.trim();
  // Already ISO-ish
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  const base = new Date(baseDateStr + "T12:00:00");
  if (Number.isNaN(base.getTime())) return null;

  // "25 March" / "25 Mar" / "March 25"
  const months = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
    sep: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  };
  let dayNum = null;
  let mon = null;
  let m = t.match(/(\d{1,2})\s+([A-Za-z]+)/);
  if (m) {
    dayNum = Number(m[1]);
    mon = months[m[2].toLowerCase()];
  } else {
    m = t.match(/([A-Za-z]+)\s+(\d{1,2})/);
    if (m) {
      mon = months[m[1].toLowerCase()];
      dayNum = Number(m[2]);
    }
  }
  if (mon != null && dayNum >= 1 && dayNum <= 31) {
    const year = base.getFullYear();
    const d = new Date(year, mon, dayNum);
    if (d < base) d.setFullYear(year + 1);
    return toYmd(d);
  }

  const lower = t.toLowerCase();
  if (lower.includes("friday")) {
    const d = new Date(base);
    const diff = (5 - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return toYmd(d);
  }
  if (lower.includes("next week")) {
    const d = new Date(base);
    d.setDate(d.getDate() + 7);
    return toYmd(d);
  }
  if (lower.includes("end of month")) {
    const d = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return toYmd(d);
  }
  return null;
}

// --------------------------------------------------------------------------- mock extractor (SPEC §8.6)
// Also matches "let's move" so the §11 demo line is picked up in mock mode.
// Exported so node:test can cover the regex rules without calling Claude.
export function mockExtract(newSegments, meetingDate) {
  const empty = {
    decisions: [],
    actionItems: [],
    blockers: [],
    questions: [],
    updates: [],
    resolvedQuestionIds: [],
  };

  const decisionRe = /(we('ve)? decided|let's go with|let's move|final|agreed)/i;
  const actionRe = /\b([A-Z][a-z]+) will (.+?)(?: by (.+?))?[.!]?$/;
  const blockerRe = /(blocked|waiting on|waiting for|stuck)/i;

  for (const seg of newSegments) {
    const text = seg.text || "";
    const id = seg.id;

    if (decisionRe.test(text)) {
      empty.decisions.push({
        title: text.length > 80 ? text.slice(0, 77) + "…" : text,
        description: text,
        topic: /launch|beta|april|march/i.test(text)
          ? "launch date"
          : /google|otp|login|sign-?in/i.test(text)
            ? "login method"
            : /sqlite|database/i.test(text)
              ? "database"
              : "general",
        keywords: text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .slice(0, 6),
        certainty: /tentative|maybe|considering/i.test(text) ? "TENTATIVE" : "AGREED",
        owner: null,
        confidence: 0.75,
        sourceSegmentIds: [id],
        sourceQuote: clipQuote(text),
      });
      continue;
    }

    const actionMatch = text.match(actionRe) || text.match(/\b([A-Z][a-z]+) will (.+)/);
    if (actionMatch) {
      const deadlineText = actionMatch[3] || (text.match(/\bby (.+?)[.!]?$/i) || [])[1] || null;
      empty.actionItems.push({
        title: `${actionMatch[1]} will ${actionMatch[2]}`.replace(/\s+/g, " ").trim().slice(0, 120),
        description: text,
        owner: actionMatch[1],
        deadline: parseLooseDeadline(deadlineText, meetingDate),
        deadlineText: deadlineText,
        priority: "MEDIUM",
        confidence: 0.8,
        sourceSegmentIds: [id],
        sourceQuote: clipQuote(text),
      });
      continue;
    }

    if (blockerRe.test(text)) {
      empty.blockers.push({
        description: text,
        owner: null,
        keywords: text
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 3)
          .slice(0, 6),
        confidence: 0.75,
        sourceSegmentIds: [id],
        sourceQuote: clipQuote(text),
      });
      continue;
    }

    if (/\?\s*$/.test(text.trim())) {
      empty.questions.push({
        question: text.trim(),
        raisedBy: seg.speaker || null,
        confidence: 0.7,
        sourceSegmentIds: [id],
        sourceQuote: clipQuote(text),
      });
    }
  }

  return empty;
}

// --------------------------------------------------------------------------- save results
function saveExtractionResult(meeting, result) {
  const names = participants(meeting.id);
  const created = [];
  const updated = [];

  const insertDecision = db.prepare(
    `INSERT INTO decisions
      (project_id, meeting_id, title, description, topic, keywords, certainty, status,
       confidence, owner, source_quote, source_segment_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PROPOSED', ?, ?, ?, ?)`
  );
  const insertAction = db.prepare(
    `INSERT INTO action_items
      (project_id, meeting_id, title, description, owner, deadline, deadline_text,
       status, priority, confidence, source_quote, source_segment_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?)`
  );
  const insertBlocker = db.prepare(
    `INSERT INTO blockers
      (project_id, meeting_id, description, owner, keywords, source_quote)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertQuestion = db.prepare(
    `INSERT INTO questions
      (project_id, meeting_id, question, raised_by, source_quote)
     VALUES (?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (const d of result.decisions || []) {
      if ((d.confidence ?? 0) < 0.5) continue;
      const info = insertDecision.run(
        meeting.project_id,
        meeting.id,
        d.title,
        d.description,
        d.topic,
        JSON.stringify(d.keywords || []),
        d.certainty === "TENTATIVE" ? "TENTATIVE" : "AGREED",
        d.confidence,
        matchOwner(d.owner, names),
        clipQuote(d.sourceQuote),
        JSON.stringify(d.sourceSegmentIds || [])
      );
      const row = shapeDecision(
        db.prepare("SELECT * FROM decisions WHERE id = ?").get(info.lastInsertRowid)
      );
      created.push({ itemType: "decision", item: row });
    }

    for (const a of result.actionItems || []) {
      if ((a.confidence ?? 0) < 0.5) continue;
      const info = insertAction.run(
        meeting.project_id,
        meeting.id,
        a.title,
        a.description,
        matchOwner(a.owner, names),
        a.deadline,
        a.deadlineText,
        a.priority || "MEDIUM",
        a.confidence,
        clipQuote(a.sourceQuote),
        JSON.stringify(a.sourceSegmentIds || [])
      );
      const row = shapeAction(
        db.prepare("SELECT * FROM action_items WHERE id = ?").get(info.lastInsertRowid)
      );
      created.push({ itemType: "action", item: row });
    }

    for (const b of result.blockers || []) {
      if ((b.confidence ?? 0) < 0.5) continue;
      const info = insertBlocker.run(
        meeting.project_id,
        meeting.id,
        b.description,
        matchOwner(b.owner, names),
        JSON.stringify(b.keywords || []),
        clipQuote(b.sourceQuote)
      );
      const row = shapeBlocker(
        db.prepare("SELECT * FROM blockers WHERE id = ?").get(info.lastInsertRowid)
      );
      created.push({ itemType: "blocker", item: row });
    }

    for (const q of result.questions || []) {
      if ((q.confidence ?? 0) < 0.5) continue;
      const info = insertQuestion.run(
        meeting.project_id,
        meeting.id,
        q.question,
        matchOwner(q.raisedBy, names),
        clipQuote(q.sourceQuote)
      );
      const row = shapeQuestion(
        db.prepare("SELECT * FROM questions WHERE id = ?").get(info.lastInsertRowid)
      );
      created.push({ itemType: "question", item: row });
    }

    for (const u of result.updates || []) {
      if (u.itemType === "decision") {
        const row = db.prepare("SELECT * FROM decisions WHERE id = ? AND meeting_id = ?").get(
          u.existingId,
          meeting.id
        );
        if (!row) continue;
        const owner = u.owner !== null ? matchOwner(u.owner, names) : row.owner;
        const description = u.description !== null ? u.description : row.description;
        db.prepare(
          `UPDATE decisions SET owner = ?, description = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(owner, description, row.id);
        updated.push({
          itemType: "decision",
          item: shapeDecision(db.prepare("SELECT * FROM decisions WHERE id = ?").get(row.id)),
        });
      } else if (u.itemType === "action") {
        const row = db.prepare("SELECT * FROM action_items WHERE id = ? AND meeting_id = ?").get(
          u.existingId,
          meeting.id
        );
        if (!row) continue;
        const owner = u.owner !== null ? matchOwner(u.owner, names) : row.owner;
        const deadline = u.deadline !== null ? u.deadline : row.deadline;
        const deadlineText = u.deadlineText !== null ? u.deadlineText : row.deadline_text;
        const description = u.description !== null ? u.description : row.description;
        if (owner !== row.owner) recordActionChange(row.id, "owner", row.owner, owner);
        if (deadline !== row.deadline) recordActionChange(row.id, "deadline", row.deadline, deadline);
        db.prepare(
          `UPDATE action_items
           SET owner = ?, deadline = ?, deadline_text = ?, description = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(owner, deadline, deadlineText, description, row.id);
        updated.push({
          itemType: "action",
          item: shapeAction(db.prepare("SELECT * FROM action_items WHERE id = ?").get(row.id)),
        });
      }
    }

    for (const qid of result.resolvedQuestionIds || []) {
      db.prepare(
        `UPDATE questions SET resolved = 1, resolved_in_meeting_id = ? WHERE id = ? AND meeting_id = ?`
      ).run(meeting.id, qid, meeting.id);
      const row = shapeQuestion(db.prepare("SELECT * FROM questions WHERE id = ?").get(qid));
      if (row) updated.push({ itemType: "question", item: row });
    }
  });

  tx();
  return { created, updated };
}

async function maybeCheckHooks(created) {
  for (const { itemType, item } of created) {
    if (itemType === "decision") {
      try {
        await checkConflicts(item);
      } catch (err) {
        console.warn("[conflicts]", err.message);
      }
    } else if (itemType === "blocker") {
      try {
        checkRecurring(item);
      } catch (err) {
        console.warn("[blockers]", err.message);
      }
    }
  }
}

function buildUserPrompt(meeting, contextSegs, newSegs, existingItems) {
  const names = participants(meeting.id);
  const date = todayInTimezone();
  const tz = process.env.TIMEZONE || "Asia/Kolkata";

  const fmt = (segs) =>
    segs.map((s) => `[#${s.id}] ${s.speaker || "Speaker"}: ${s.text}`).join("\n") || "(none)";

  return [
    `MEETING: ${meeting.title}`,
    `AGENDA: ${meeting.agenda || "(none)"}`,
    `DATE: ${date}`,
    `TIMEZONE: ${tz}`,
    `PARTICIPANTS: ${names.join(", ") || "(none)"}`,
    "",
    "CONTEXT (for understanding only — do not extract from these):",
    fmt(contextSegs),
    "",
    "NEW lines (extract from these; use their [#id] as sourceSegmentIds):",
    fmt(newSegs),
    "",
    "EXISTING_ITEMS already found in this meeting (update these instead of duplicating):",
    JSON.stringify(existingItems, null, 2),
  ].join("\n");
}

/**
 * Run extraction on a specific list of NEW segments (and optional context).
 * Used by the live buffer and by upload chunking.
 */
export async function runExtractionOnSegments(meetingId, newSegments, { contextSegments = [] } = {}) {
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(meetingId);
  if (!meeting || !newSegments.length) return null;

  const started = Date.now();
  emitToMeeting(meetingId, "ai:status", { state: "processing" });

  try {
    let result;
    if (isMockMode()) {
      result = mockExtract(newSegments, todayInTimezone());
      result = ExtractionSchema.parse(result);
      logMockRun({ meetingId, kind: "EXTRACT", latencyMs: Date.now() - started });
    } else {
      const existingItems = listExistingItemsForPrompt(meetingId);
      const user = buildUserPrompt(meeting, contextSegments, newSegments, existingItems);
      result = await askClaude({
        system: SYSTEM_PROMPT,
        user,
        schema: ExtractionSchema,
        effort: "low",
        meetingId,
        kind: "EXTRACT",
      });
    }

    const { created, updated } = saveExtractionResult(meeting, result);

    for (const c of created) emitToMeeting(meetingId, "item:created", c);
    for (const u of updated) emitToMeeting(meetingId, "item:updated", u);

    await maybeCheckHooks(created);

    const latencyMs = Date.now() - started;
    emitToMeeting(meetingId, "ai:status", { state: "idle", latencyMs });
    return { created, updated, latencyMs };
  } catch (err) {
    console.error("[extraction]", err);
    emitToMeeting(meetingId, "ai:status", {
      state: "error",
      message: err.message || String(err),
    });
    return null;
  }
}

async function runBufferedMeeting(meetingId, { force = false } = {}) {
  const buf = getBuffer(meetingId);
  if (buf.running) return;
  if (!buf.newSegments.length) return;

  const ageMs = Date.now() - buf.lastRunAt;
  const ready = force || buf.newSegments.length >= 4 || (buf.newSegments.length >= 1 && ageMs >= 20000);
  if (!ready) return;

  buf.running = true;
  const batch = buf.newSegments.splice(0, buf.newSegments.length);
  buf.lastRunAt = Date.now();

  try {
    // CONTEXT = last 8 already-processed lines before this batch
    const beforeIds = batch.map((s) => s.id);
    const minId = Math.min(...beforeIds);
    const contextSegments = db
      .prepare(
        `SELECT * FROM segments
         WHERE meeting_id = ? AND id < ?
         ORDER BY seq DESC LIMIT 8`
      )
      .all(meetingId, minId)
      .reverse();

    await runExtractionOnSegments(meetingId, batch, { contextSegments });
    for (const s of batch) buf.processedIds.add(s.id);
  } finally {
    buf.running = false;
  }
}

/** Force-process anything still buffered (call when the meeting ends). */
export async function flushMeeting(meetingId) {
  await runBufferedMeeting(meetingId, { force: true });
  buffers.delete(Number(meetingId));
}

/**
 * Upload mode: process the whole transcript in chunks of 15 lines (SPEC Step 4).
 */
export async function processUploadChunks(meetingId, segments) {
  const chunkSize = 15;
  for (let i = 0; i < segments.length; i += chunkSize) {
    const chunk = segments.slice(i, i + chunkSize);
    const contextSegments =
      i === 0
        ? []
        : segments.slice(Math.max(0, i - 8), i);
    await runExtractionOnSegments(meetingId, chunk, { contextSegments });
  }
}

/** Background tick: every 5s check each buffer (SPEC §8.2). */
export function startExtractionLoop() {
  setInterval(() => {
    for (const meetingId of buffers.keys()) {
      runBufferedMeeting(meetingId).catch((err) => console.error("[extraction loop]", err));
    }
  }, 5000);
  console.log("[extraction] buffer loop started (every 5s)");
}

export function getMeetingItems(meetingId) {
  return {
    decisions: listMeetingDecisions(meetingId),
    actionItems: listMeetingActions(meetingId),
    blockers: listMeetingBlockers(meetingId),
    questions: listMeetingQuestions(meetingId),
  };
}
