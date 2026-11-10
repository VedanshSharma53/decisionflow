/**
 * Conflict / change detection for a newly extracted decision (SPEC §8.3).
 * Step 1: keyword candidates  →  Step 2: AI (or mock) compare  →  Step 3: PENDING relations.
 * Called from extraction after save — must not throw up into the live meeting.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../db.js";
import { askClaude, isMockMode, logMockRun } from "./ai.js";
import { ComparisonSchema } from "./schemas.js";
import { scoreDecisions } from "./similarity.js";
import { emitToMeeting } from "./realtime.js";
import { shapeDecision } from "./items.js";

const PROMPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prompts", "comparison.md");
const SYSTEM_PROMPT = fs.readFileSync(PROMPT_PATH, "utf8");

function parseKeywords(row) {
  if (Array.isArray(row.keywords)) return row.keywords;
  try {
    return row.keywords ? JSON.parse(row.keywords) : [];
  } catch {
    return [];
  }
}

function asDecision(row) {
  return {
    ...row,
    keywords: parseKeywords(row),
  };
}

/** Pull dates like "15 March" / "1 April" / "2026-04-01" and bare numbers from text. */
function extractDatesAndNumbers(text) {
  const s = String(text || "");
  const dates = [];
  const dateRe =
    /\b(\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))\b/gi;
  let m;
  while ((m = dateRe.exec(s))) dates.push(m[1].replace(/\s+/g, " ").toLowerCase());
  const iso = s.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (iso) dates.push(...iso);
  const numbers = (s.match(/\b\d+(?:\.\d+)?\b/g) || []).map((n) => n.toLowerCase());
  return { dates: [...new Set(dates)], numbers: [...new Set(numbers)] };
}

/**
 * Mock comparison (SPEC §8.6): same topic word + different date/number → MODIFIES.
 * Also flags same-topic decisions that clearly change scope (demo: OTP-only vs Google+OTP).
 */
function mockCompare(newDecision, candidates) {
  const results = [];
  const newTopicWords = new Set(
    String(newDecision.topic || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
  );
  const newDN = extractDatesAndNumbers(`${newDecision.title} ${newDecision.description || ""}`);

  for (const c of candidates) {
    const oldTopicWords = new Set(
      String(c.topic || "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
    );
    let sharedTopicWord = false;
    for (const w of newTopicWords) if (oldTopicWords.has(w)) sharedTopicWord = true;
    const sameTopic =
      String(newDecision.topic || "")
        .trim()
        .toLowerCase() ===
        String(c.topic || "")
          .trim()
          .toLowerCase() && Boolean(String(newDecision.topic || "").trim());

    if (!sharedTopicWord && !sameTopic) {
      results.push({
        candidateId: c.id,
        relation: "UNRELATED",
        confidence: 0.9,
        explanation: `"${newDecision.title}" and "${c.title}" look like different subjects.`,
        changedFields: [],
      });
      continue;
    }

    const oldDN = extractDatesAndNumbers(`${c.title} ${c.description || ""}`);
    const changedFields = [];

    // Date / number differences → MODIFIES (SPEC §8.6)
    for (const d of newDN.dates) {
      if (!oldDN.dates.includes(d) && oldDN.dates.length) {
        changedFields.push({ field: "date", from: oldDN.dates[0], to: d });
      }
    }
    for (const n of newDN.numbers) {
      if (!oldDN.numbers.includes(n) && oldDN.numbers.length && !/^\d{4}$/.test(n)) {
        // skip lone years when we already have a date field
        if (!changedFields.some((f) => f.field === "date")) {
          changedFields.push({ field: "number", from: oldDN.numbers[0], to: n });
        }
      }
    }

    // Same topic, different wording — treat as a modification for the demo
    if (changedFields.length === 0 && sameTopic) {
      const a = String(newDecision.title || "").toLowerCase();
      const b = String(c.title || "").toLowerCase();
      if (a !== b) {
        changedFields.push({
          field: "scope",
          from: c.title,
          to: newDecision.title,
        });
      }
    }

    if (changedFields.length === 0) {
      results.push({
        candidateId: c.id,
        relation: "DUPLICATE",
        confidence: 0.7,
        explanation: `"${newDecision.title}" looks the same as earlier "${c.title}".`,
        changedFields: [],
      });
    } else {
      const fieldNote = changedFields.map((f) => `${f.field}: ${f.from} → ${f.to}`).join("; ");
      results.push({
        candidateId: c.id,
        relation: "MODIFIES",
        confidence: 0.7,
        explanation: `Earlier decision "${c.title}" is being updated by "${newDecision.title}" (${fieldNote}).`,
        changedFields,
      });
    }
  }

  return { results };
}

function shapeRelationRow(row) {
  if (!row) return null;
  let changed_fields = [];
  try {
    changed_fields = row.changed_fields ? JSON.parse(row.changed_fields) : [];
  } catch {
    changed_fields = [];
  }
  return { ...row, changed_fields };
}

function loadDecisionWithMeeting(id) {
  const row = db
    .prepare(
      `SELECT d.*, m.title AS meeting_title, m.scheduled_at AS meeting_scheduled_at,
              m.started_at AS meeting_started_at
       FROM decisions d
       JOIN meetings m ON m.id = d.meeting_id
       WHERE d.id = ?`
    )
    .get(id);
  return row ? shapeDecision(row) : null;
}

/**
 * Run conflict detection for one newly saved decision.
 * Does not block extraction on failure — caller already wraps in try/catch.
 */
export async function check(decision) {
  if (!decision?.id || !decision.project_id) return;

  const fresh = asDecision(
    db.prepare("SELECT * FROM decisions WHERE id = ?").get(decision.id)
  );
  if (!fresh) return;

  // Step 1 — similar older decisions in the same project
  const candidates = db
    .prepare(
      `SELECT * FROM decisions
       WHERE project_id = ?
         AND id != ?
         AND status IN ('PROPOSED', 'APPROVED', 'MODIFIED')
       ORDER BY id ASC`
    )
    .all(fresh.project_id, fresh.id)
    .map(asDecision);

  const scored = candidates
    .map((c) => ({ ...c, _score: scoreDecisions(fresh, c) }))
    .filter((c) => c._score >= 0.2)
    .sort((a, b) => b._score - a._score)
    .slice(0, 5);

  if (scored.length === 0) return; // brand-new topic

  // Step 2 — AI or mock comparison
  const started = Date.now();
  let comparison;
  if (isMockMode()) {
    comparison = ComparisonSchema.parse(mockCompare(fresh, scored));
    logMockRun({ meetingId: fresh.meeting_id, kind: "COMPARE", latencyMs: Date.now() - started });
  } else {
    const user = [
      "NEW decision:",
      JSON.stringify(
        {
          id: fresh.id,
          title: fresh.title,
          description: fresh.description,
          topic: fresh.topic,
          keywords: fresh.keywords,
        },
        null,
        2
      ),
      "",
      "EARLIER candidate decisions:",
      JSON.stringify(
        scored.map((c) => ({
          id: c.id,
          title: c.title,
          description: c.description,
          topic: c.topic,
          keywords: c.keywords,
          status: c.status,
        })),
        null,
        2
      ),
      "",
      "Return one result per candidate (use candidateId = that decision's id).",
    ].join("\n");

    comparison = await askClaude({
      system: SYSTEM_PROMPT,
      user,
      schema: ComparisonSchema,
      effort: "medium",
      meetingId: fresh.meeting_id,
      kind: "COMPARE",
    });
  }

  // Step 3 — save PENDING relations (confidence ≥ 0.6, not UNRELATED)
  const insert = db.prepare(
    `INSERT OR IGNORE INTO relations
       (new_decision_id, old_decision_id, type, explanation, confidence, changed_fields, review_status)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING')`
  );

  for (const r of comparison.results || []) {
    if (!r || r.relation === "UNRELATED") continue;
    if ((r.confidence ?? 0) < 0.6) continue;
    if (!scored.some((c) => c.id === r.candidateId)) continue;

    const info = insert.run(
      fresh.id,
      r.candidateId,
      r.relation,
      r.explanation || null,
      r.confidence,
      JSON.stringify(r.changedFields || [])
    );
    if (info.changes === 0) continue; // already existed (UNIQUE pair)

    // Full row with new_*/old_* fields so ReviewCard can render without extra fetches
    const relation = getRelationDetail(Number(info.lastInsertRowid));
    const newDecision = loadDecisionWithMeeting(fresh.id);
    const oldDecision = loadDecisionWithMeeting(r.candidateId);

    emitToMeeting(fresh.meeting_id, "relation:flagged", {
      relation,
      newDecision,
      oldDecision,
    });
  }
}

/** Shape used by the relations API and ReviewCard. */
export function getRelationDetail(id) {
  const row = db
    .prepare(
      `SELECT r.*,
              nd.title AS new_title, nd.status AS new_status, nd.meeting_id AS new_meeting_id,
              nd.description AS new_description, nd.certainty AS new_certainty,
              od.title AS old_title, od.status AS old_status, od.meeting_id AS old_meeting_id,
              od.description AS old_description, od.certainty AS old_certainty,
              nm.title AS new_meeting_title, nm.scheduled_at AS new_meeting_scheduled_at,
              nm.started_at AS new_meeting_started_at,
              om.title AS old_meeting_title, om.scheduled_at AS old_meeting_scheduled_at,
              om.started_at AS old_meeting_started_at
       FROM relations r
       JOIN decisions nd ON nd.id = r.new_decision_id
       JOIN decisions od ON od.id = r.old_decision_id
       JOIN meetings nm ON nm.id = nd.meeting_id
       JOIN meetings om ON om.id = od.meeting_id
       WHERE r.id = ?`
    )
    .get(id);
  return shapeRelationRow(row);
}
