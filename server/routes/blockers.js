// Blockers API (SPEC §9).
import { Router } from "express";
import db from "../db.js";
import { HttpError } from "../middleware/errors.js";
import { listRecurringBlockerGroups } from "../services/blockers.js";
import { emitToMeeting } from "../services/realtime.js";
import { shapeBlocker } from "../services/items.js";

const router = Router();

router.get("/", (req, res) => {
  const projectId = Number(req.query.projectId);
  if (!projectId) throw new HttpError(400, "projectId is required");

  const recurringOnly = req.query.recurring === "1" || req.query.recurring === "true";
  if (recurringOnly) {
    return res.json(listRecurringBlockerGroups(projectId));
  }

  const rows = db
    .prepare(
      `SELECT b.*, m.title AS meeting_title
       FROM blockers b
       JOIN meetings m ON m.id = b.meeting_id
       WHERE b.project_id = ?
       ORDER BY b.id DESC`
    )
    .all(projectId)
    .map(shapeBlocker);
  res.json(rows);
});

router.patch("/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM blockers WHERE id = ?").get(Number(req.params.id));
  if (!row) throw new HttpError(404, "Blocker not found");

  const description =
    req.body.description != null ? String(req.body.description).trim() : row.description;
  const owner =
    req.body.owner !== undefined ? String(req.body.owner || "").trim() || null : row.owner;
  const resolved =
    req.body.resolved !== undefined ? (req.body.resolved ? 1 : 0) : row.resolved;

  if (!description) throw new HttpError(400, "Description is required");

  db.prepare(
    `UPDATE blockers SET description = ?, owner = ?, resolved = ? WHERE id = ?`
  ).run(description, owner, resolved, row.id);

  const updated = shapeBlocker(db.prepare("SELECT * FROM blockers WHERE id = ?").get(row.id));
  emitToMeeting(row.meeting_id, "item:updated", { itemType: "blocker", item: updated });
  res.json(updated);
});

export default router;
