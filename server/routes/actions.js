// Action items API: list with filters, update, history (SPEC §9, §4).
import { Router } from "express";
import db from "../db.js";
import { HttpError } from "../middleware/errors.js";
import { updateActionItem } from "../services/lifecycle.js";
import { emitToMeeting } from "../services/realtime.js";
import { shapeAction } from "../services/items.js";

const router = Router();

const ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "BLOCKED"];

function getAction(id) {
  const row = db.prepare("SELECT * FROM action_items WHERE id = ?").get(id);
  if (!row) throw new HttpError(404, "Action item not found");
  return row;
}

function todayYmd() {
  // Asia/Kolkata default from .env — for overdue we compare calendar dates as YYYY-MM-DD strings
  const tz = process.env.TIMEZONE || "Asia/Kolkata";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function withOverdue(row) {
  const shaped = shapeAction(row);
  const today = todayYmd();
  const overdue =
    Boolean(shaped.deadline) &&
    shaped.status !== "DONE" &&
    shaped.deadline < today;
  return { ...shaped, overdue };
}

// GET /api/actions?projectId=&owner=&status=&overdue=1
router.get("/", (req, res) => {
  const projectId = Number(req.query.projectId);
  if (!projectId) throw new HttpError(400, "projectId is required");

  const owner = req.query.owner ? String(req.query.owner).trim() : null;
  const status = req.query.status ? String(req.query.status) : null;
  const overdueOnly = req.query.overdue === "1" || req.query.overdue === "true";

  if (status && !ACTION_STATUSES.includes(status)) {
    throw new HttpError(400, "Invalid status filter");
  }

  const params = [projectId];
  let sql = `
    SELECT a.*, m.title AS meeting_title
    FROM action_items a
    JOIN meetings m ON m.id = a.meeting_id
    WHERE a.project_id = ?`;

  if (owner) {
    sql += " AND LOWER(a.owner) = LOWER(?)";
    params.push(owner);
  }
  if (status) {
    sql += " AND a.status = ?";
    params.push(status);
  }
  if (overdueOnly) {
    const today = todayYmd();
    sql += " AND a.deadline IS NOT NULL AND a.deadline < ? AND a.status != 'DONE'";
    params.push(today);
  }

  // Overdue first, then soonest deadline, then newest
  sql += ` ORDER BY
    CASE WHEN a.deadline IS NOT NULL AND a.status != 'DONE' AND a.deadline < date('now') THEN 0 ELSE 1 END,
    a.deadline IS NULL, a.deadline ASC, a.id DESC`;

  res.json(db.prepare(sql).all(...params).map(withOverdue));
});

// GET /api/actions/:id/history  (must be before /:id if we add that later)
router.get("/:id/history", (req, res) => {
  const action = getAction(Number(req.params.id));
  const history = db
    .prepare(
      `SELECT h.*, u.name AS changed_by_name
       FROM action_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.action_id = ?
       ORDER BY h.changed_at ASC, h.id ASC`
    )
    .all(action.id);
  res.json(history);
});

// GET /api/actions/:id
router.get("/:id", (req, res) => {
  const action = withOverdue(getAction(Number(req.params.id)));
  const meeting = db
    .prepare("SELECT id, title, scheduled_at, status FROM meetings WHERE id = ?")
    .get(action.meeting_id);
  const history = db
    .prepare(
      `SELECT h.*, u.name AS changed_by_name
       FROM action_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.action_id = ?
       ORDER BY h.changed_at ASC, h.id ASC`
    )
    .all(action.id);
  res.json({ ...action, meeting, history });
});

// PATCH /api/actions/:id
router.patch("/:id", (req, res) => {
  const updated = withOverdue(updateActionItem(Number(req.params.id), req.body, req.user.id));
  emitToMeeting(updated.meeting_id, "item:updated", { itemType: "action", item: updated });
  res.json(updated);
});

export default router;
