// Decisions API: list/search, detail, edit, approve, reject (SPEC §9, §4).
import { Router } from "express";
import db from "../db.js";
import { HttpError } from "../middleware/errors.js";
import { approveDecision, rejectDecision } from "../services/lifecycle.js";
import { emitToMeeting } from "../services/realtime.js";
import { shapeDecision } from "../services/items.js";

const router = Router();

const DECISION_STATUSES = ["PROPOSED", "APPROVED", "MODIFIED", "SUPERSEDED", "REJECTED"];

function getDecision(id) {
  const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id);
  if (!row) throw new HttpError(404, "Decision not found");
  return row;
}

/** Escape FTS5 special characters so a typed search string is treated as words. */
function ftsQuery(raw) {
  return String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `"${word.replace(/"/g, "")}"`)
    .join(" ");
}

function shapeRelation(row) {
  if (!row) return null;
  let changed_fields = [];
  try {
    changed_fields = row.changed_fields ? JSON.parse(row.changed_fields) : [];
  } catch {
    changed_fields = [];
  }
  return { ...row, changed_fields };
}

// --------------------------------------------------------------------------- list + search
// GET /api/decisions?projectId=&q=&status=&meetingId=
router.get("/", (req, res) => {
  const projectId = Number(req.query.projectId);
  if (!projectId) throw new HttpError(400, "projectId is required");

  const status = req.query.status ? String(req.query.status) : null;
  const meetingId = req.query.meetingId ? Number(req.query.meetingId) : null;
  const q = req.query.q ? String(req.query.q).trim() : "";

  if (status && !DECISION_STATUSES.includes(status)) {
    throw new HttpError(400, "Invalid status filter");
  }

  const params = [projectId];
  let sql = `
    SELECT d.*, m.title AS meeting_title, m.scheduled_at AS meeting_scheduled_at
    FROM decisions d
    JOIN meetings m ON m.id = d.meeting_id
    WHERE d.project_id = ?`;

  if (status) {
    sql += " AND d.status = ?";
    params.push(status);
  }
  if (meetingId) {
    sql += " AND d.meeting_id = ?";
    params.push(meetingId);
  }
  if (q) {
    const match = ftsQuery(q);
    if (!match) {
      return res.json([]);
    }
    // decisions_fts is kept in sync by the schema triggers
    sql += ` AND d.id IN (SELECT rowid FROM decisions_fts WHERE decisions_fts MATCH ?)`;
    params.push(match);
  }

  sql += " ORDER BY d.created_at DESC, d.id DESC";

  const rows = db.prepare(sql).all(...params).map((row) => shapeDecision(row));
  res.json(rows);
});

// --------------------------------------------------------------------------- detail
// GET /api/decisions/:id  → decision + history + relations both ways + source lines
router.get("/:id", (req, res) => {
  const decision = shapeDecision(getDecision(Number(req.params.id)));

  const meeting = db
    .prepare("SELECT id, title, scheduled_at, started_at, status FROM meetings WHERE id = ?")
    .get(decision.meeting_id);

  const history = db
    .prepare(
      `SELECT h.*, u.name AS changed_by_name
       FROM decision_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.decision_id = ?
       ORDER BY h.changed_at ASC, h.id ASC`
    )
    .all(decision.id);

  // Relations where this decision is the new one OR the old one
  const relations = db
    .prepare(
      `SELECT r.*,
              nd.title AS new_title, nd.status AS new_status, nd.meeting_id AS new_meeting_id,
              od.title AS old_title, od.status AS old_status, od.meeting_id AS old_meeting_id,
              nm.title AS new_meeting_title, om.title AS old_meeting_title
       FROM relations r
       JOIN decisions nd ON nd.id = r.new_decision_id
       JOIN decisions od ON od.id = r.old_decision_id
       JOIN meetings nm ON nm.id = nd.meeting_id
       JOIN meetings om ON om.id = od.meeting_id
       WHERE r.new_decision_id = ? OR r.old_decision_id = ?
       ORDER BY r.created_at ASC, r.id ASC`
    )
    .all(decision.id, decision.id)
    .map(shapeRelation);

  // Source transcript lines (from source_segment_ids JSON)
  const segmentIds = Array.isArray(decision.source_segment_ids)
    ? decision.source_segment_ids.map(Number).filter(Boolean)
    : [];
  let sourceLines = [];
  if (segmentIds.length > 0) {
    const placeholders = segmentIds.map(() => "?").join(",");
    sourceLines = db
      .prepare(
        `SELECT id, seq, speaker, text, created_at
         FROM segments
         WHERE id IN (${placeholders})
         ORDER BY seq ASC`
      )
      .all(...segmentIds);
  }

  res.json({
    ...decision,
    meeting,
    history,
    relations,
    sourceLines,
  });
});

// --------------------------------------------------------------------------- edit
router.patch("/:id", (req, res) => {
  const decision = getDecision(Number(req.params.id));
  const title = req.body.title != null ? String(req.body.title).trim() : decision.title;
  const description =
    req.body.description != null ? String(req.body.description).trim() : decision.description;
  const owner = req.body.owner != null ? String(req.body.owner).trim() || null : decision.owner;

  if (!title) throw new HttpError(400, "Title is required");

  db.prepare(
    `UPDATE decisions SET title = ?, description = ?, owner = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(title, description, owner, decision.id);

  const updated = shapeDecision(getDecision(decision.id));
  emitToMeeting(decision.meeting_id, "item:updated", { itemType: "decision", item: updated });
  res.json(updated);
});

// --------------------------------------------------------------------------- approve / reject
router.post("/:id/approve", (req, res) => {
  const updated = shapeDecision(approveDecision(Number(req.params.id), req.user.id));
  emitToMeeting(updated.meeting_id, "item:updated", { itemType: "decision", item: updated });
  res.json(updated);
});

router.post("/:id/reject", (req, res) => {
  const updated = shapeDecision(
    rejectDecision(Number(req.params.id), req.user.id, req.body.reason || null)
  );
  emitToMeeting(updated.meeting_id, "item:updated", { itemType: "decision", item: updated });
  res.json(updated);
});

export default router;
