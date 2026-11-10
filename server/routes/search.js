/**
 * Global search across decisions (FTS), action items, and transcript lines (SPEC §9).
 * GET /api/search?projectId=&q=
 */
import { Router } from "express";
import db from "../db.js";
import { HttpError } from "../middleware/errors.js";
import { shapeAction, shapeDecision } from "../services/items.js";

const router = Router();

/** Quote each word so FTS5 treats user input as literal terms. */
function ftsQuery(raw) {
  return String(raw || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `"${word.replace(/"/g, "")}"`)
    .join(" ");
}

router.get("/", (req, res) => {
  const projectId = Number(req.query.projectId);
  const q = String(req.query.q || "").trim();
  if (!projectId) throw new HttpError(400, "projectId is required");
  if (!q) {
    return res.json({ q, decisions: [], actionItems: [], segments: [] });
  }

  const match = ftsQuery(q);
  if (!match) {
    return res.json({ q, decisions: [], actionItems: [], segments: [] });
  }

  // Decisions — FTS5 index on title/description/topic
  const decisions = db
    .prepare(
      `SELECT d.*, m.title AS meeting_title
       FROM decisions d
       JOIN meetings m ON m.id = d.meeting_id
       WHERE d.project_id = ?
         AND d.id IN (SELECT rowid FROM decisions_fts WHERE decisions_fts MATCH ?)
       ORDER BY d.created_at DESC
       LIMIT 20`
    )
    .all(projectId, match)
    .map(shapeDecision);

  // Action items — LIKE on title/description/owner (no FTS table for these)
  const like = `%${q.replace(/%/g, "").replace(/_/g, "")}%`;
  const actionItems = db
    .prepare(
      `SELECT a.*, m.title AS meeting_title
       FROM action_items a
       JOIN meetings m ON m.id = a.meeting_id
       WHERE a.project_id = ?
         AND (a.title LIKE ? OR IFNULL(a.description, '') LIKE ? OR IFNULL(a.owner, '') LIKE ?)
       ORDER BY a.id DESC
       LIMIT 20`
    )
    .all(projectId, like, like, like)
    .map(shapeAction);

  // Transcript lines — FTS5 on segments, scoped to this project's meetings
  const segments = db
    .prepare(
      `SELECT s.id, s.meeting_id, s.seq, s.speaker, s.text, s.created_at,
              m.title AS meeting_title
       FROM segments s
       JOIN meetings m ON m.id = s.meeting_id
       WHERE m.project_id = ?
         AND s.id IN (SELECT rowid FROM segments_fts WHERE segments_fts MATCH ?)
       ORDER BY s.id DESC
       LIMIT 20`
    )
    .all(projectId, match);

  res.json({ q, decisions, actionItems, segments });
});

export default router;
