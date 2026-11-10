/**
 * Relations API — list pending flags and apply human review (SPEC §4, §8.3 step 4, §9).
 * Status changes go ONLY through lifecycle.js.
 */
import { Router } from "express";
import db from "../db.js";
import { HttpError } from "../middleware/errors.js";
import { changeDecisionStatus } from "../services/lifecycle.js";
import { emitToMeeting } from "../services/realtime.js";
import { shapeDecision } from "../services/items.js";
import { getRelationDetail } from "../services/conflicts.js";

const router = Router();

const REVIEW_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"];
const RESOLUTIONS = ["KEEP_NEW", "KEEP_OLD", "KEEP_BOTH"];

function shapeListRow(row) {
  if (!row) return null;
  let changed_fields = [];
  try {
    changed_fields = row.changed_fields ? JSON.parse(row.changed_fields) : [];
  } catch {
    changed_fields = [];
  }
  return { ...row, changed_fields };
}

/**
 * Only call lifecycle when the transition is actually needed.
 * SPEC §4 only allows MODIFIED/SUPERSEDED from APPROVED (or MODIFIED) —
 * if the older decision is still PROPOSED, approve it first, then apply the change.
 */
function maybeChange(decisionId, toStatus, opts) {
  const row = db.prepare("SELECT id, status FROM decisions WHERE id = ?").get(decisionId);
  if (!row) throw new HttpError(404, "Decision not found");
  if (row.status === toStatus) {
    return db.prepare("SELECT * FROM decisions WHERE id = ?").get(decisionId);
  }

  if (
    (toStatus === "MODIFIED" || toStatus === "SUPERSEDED") &&
    row.status === "PROPOSED"
  ) {
    changeDecisionStatus(decisionId, "APPROVED", {
      reason: "Auto-approved before applying relation review",
      userId: opts.userId,
      relationId: opts.relationId,
    });
  }

  return changeDecisionStatus(decisionId, toStatus, opts);
}

// GET /api/relations?projectId=&status=PENDING&meetingId=
router.get("/", (req, res) => {
  const projectId = Number(req.query.projectId);
  if (!projectId) throw new HttpError(400, "projectId is required");

  const status = req.query.status ? String(req.query.status) : null;
  const meetingId = req.query.meetingId ? Number(req.query.meetingId) : null;

  if (status && !REVIEW_STATUSES.includes(status)) {
    throw new HttpError(400, "Invalid review status filter");
  }

  const params = [projectId];
  let sql = `
    SELECT r.*,
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
    WHERE nd.project_id = ?`;

  if (status) {
    sql += " AND r.review_status = ?";
    params.push(status);
  }
  if (meetingId) {
    // Flags that appeared in this meeting (new decision belongs here)
    sql += " AND nd.meeting_id = ?";
    params.push(meetingId);
  }

  sql += " ORDER BY r.created_at DESC, r.id DESC";
  res.json(db.prepare(sql).all(...params).map(shapeListRow));
});

// POST /api/relations/:id/review  { action, resolution?, note? }
router.post("/:id/review", (req, res) => {
  const relationId = Number(req.params.id);
  const relation = db.prepare("SELECT * FROM relations WHERE id = ?").get(relationId);
  if (!relation) throw new HttpError(404, "Relation not found");
  if (relation.review_status !== "PENDING") {
    throw new HttpError(409, `Relation is already ${relation.review_status}`);
  }

  const action = String(req.body.action || "").toUpperCase();
  if (action !== "ACCEPT" && action !== "REJECT") {
    throw new HttpError(400, "action must be ACCEPT or REJECT");
  }

  const note = req.body.note != null ? String(req.body.note).trim() || null : null;
  let resolution =
    req.body.resolution != null ? String(req.body.resolution).toUpperCase() : null;

  if (action === "ACCEPT" && relation.type === "CONFLICTS") {
    if (!RESOLUTIONS.includes(resolution)) {
      throw new HttpError(400, "CONFLICTS require resolution: KEEP_NEW, KEEP_OLD, or KEEP_BOTH");
    }
  } else if (action === "ACCEPT") {
    resolution = null; // only CONFLICTS store a resolution
  } else {
    resolution = null;
  }

  const newId = relation.new_decision_id;
  const oldId = relation.old_decision_id;
  const touchedMeetingIds = new Set();

  // One SQLite transaction for the whole review (SPEC §8.3 step 4)
  const run = db.transaction(() => {
    if (action === "REJECT") {
      db.prepare(
        `UPDATE relations
         SET review_status = 'REJECTED', reviewed_by = ?, reviewed_at = datetime('now'),
             note = ?, resolution = NULL
         WHERE id = ?`
      ).run(req.user.id, note, relationId);
    } else {
      // ACCEPT — apply SPEC §4 table via lifecycle only
      if (relation.type === "DUPLICATE") {
        maybeChange(newId, "REJECTED", {
          reason: `duplicate of #${oldId}`,
          userId: req.user.id,
          relationId,
        });
      } else if (relation.type === "MODIFIES") {
        maybeChange(oldId, "MODIFIED", {
          reason: `Modified by decision #${newId}`,
          userId: req.user.id,
          relationId,
        });
        maybeChange(newId, "APPROVED", {
          reason: `Approved (modifies #${oldId})`,
          userId: req.user.id,
          relationId,
        });
      } else if (relation.type === "SUPERSEDES") {
        maybeChange(oldId, "SUPERSEDED", {
          reason: `Superseded by decision #${newId}`,
          userId: req.user.id,
          relationId,
          supersededById: newId,
        });
        maybeChange(newId, "APPROVED", {
          reason: `Approved (supersedes #${oldId})`,
          userId: req.user.id,
          relationId,
        });
      } else if (relation.type === "CONFLICTS") {
        if (resolution === "KEEP_NEW") {
          // Acts like SUPERSEDES
          maybeChange(oldId, "SUPERSEDED", {
            reason: `Conflict resolved: keep new (#${newId})`,
            userId: req.user.id,
            relationId,
            supersededById: newId,
          });
          maybeChange(newId, "APPROVED", {
            reason: `Conflict resolved: keep new`,
            userId: req.user.id,
            relationId,
          });
        } else if (resolution === "KEEP_OLD") {
          maybeChange(newId, "REJECTED", {
            reason: `Conflict resolved: keep old (#${oldId})`,
            userId: req.user.id,
            relationId,
          });
        }
        // KEEP_BOTH → no status changes
      }

      db.prepare(
        `UPDATE relations
         SET review_status = 'ACCEPTED', reviewed_by = ?, reviewed_at = datetime('now'),
             note = ?, resolution = ?
         WHERE id = ?`
      ).run(req.user.id, note, resolution, relationId);
    }

    const newDec = db.prepare("SELECT * FROM decisions WHERE id = ?").get(newId);
    const oldDec = db.prepare("SELECT * FROM decisions WHERE id = ?").get(oldId);
    if (newDec) touchedMeetingIds.add(newDec.meeting_id);
    if (oldDec) touchedMeetingIds.add(oldDec.meeting_id);

    return {
      relation: getRelationDetail(relationId),
      newDecision: shapeDecision(newDec),
      oldDecision: shapeDecision(oldDec),
    };
  });

  const result = run();

  // Push live badge updates to every meeting room that cares
  for (const mid of touchedMeetingIds) {
    if (result.newDecision?.meeting_id === mid) {
      emitToMeeting(mid, "item:updated", { itemType: "decision", item: result.newDecision });
    }
    if (result.oldDecision?.meeting_id === mid) {
      emitToMeeting(mid, "item:updated", { itemType: "decision", item: result.oldDecision });
    }
    emitToMeeting(mid, "relation:reviewed", {
      relation: result.relation,
      newDecision: result.newDecision,
      oldDecision: result.oldDecision,
    });
  }

  res.json(result);
});

export default router;
