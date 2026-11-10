// ALL decision status changes go through here (SPEC §4). The AI never changes status itself.
import db from "../db.js";
import { HttpError } from "../middleware/errors.js";

// Allowed transitions. Anything else → HTTP 409.
const ALLOWED = {
  PROPOSED: ["APPROVED", "REJECTED"],
  APPROVED: ["MODIFIED", "SUPERSEDED"],
  MODIFIED: ["SUPERSEDED", "MODIFIED"],
  SUPERSEDED: [],
  REJECTED: [],
};

/**
 * Change a decision's status and append a decision_history row.
 * Returns the updated decision row.
 */
export function changeDecisionStatus(
  decisionId,
  toStatus,
  { reason = null, userId = null, relationId = null, supersededById = null } = {}
) {
  const decision = db.prepare("SELECT * FROM decisions WHERE id = ?").get(decisionId);
  if (!decision) throw new HttpError(404, "Decision not found");

  const from = decision.status;
  const allowed = ALLOWED[from] || [];
  if (!allowed.includes(toStatus)) {
    throw new HttpError(409, `Cannot change decision status from ${from} to ${toStatus}`);
  }

  const run = db.transaction(() => {
    db.prepare(
      `UPDATE decisions
       SET status = ?,
           superseded_by_id = COALESCE(?, superseded_by_id),
           approved_by = CASE WHEN ? = 'APPROVED' THEN ? ELSE approved_by END,
           approved_at = CASE WHEN ? = 'APPROVED' THEN datetime('now') ELSE approved_at END,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(toStatus, supersededById, toStatus, userId, toStatus, decisionId);

    db.prepare(
      `INSERT INTO decision_history (decision_id, from_status, to_status, reason, relation_id, changed_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(decisionId, from, toStatus, reason, relationId, userId);

    return db.prepare("SELECT * FROM decisions WHERE id = ?").get(decisionId);
  });

  return run();
}

export function approveDecision(decisionId, userId) {
  return changeDecisionStatus(decisionId, "APPROVED", {
    reason: "Approved by user",
    userId,
  });
}

export function rejectDecision(decisionId, userId, reason) {
  return changeDecisionStatus(decisionId, "REJECTED", {
    reason: reason || "Rejected by user",
    userId,
  });
}

/**
 * Record a field change on an action item (status / owner / deadline).
 */
export function recordActionChange(actionId, field, oldValue, newValue, userId = null) {
  db.prepare(
    `INSERT INTO action_history (action_id, field, old_value, new_value, changed_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run(actionId, field, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue), userId);
}

const ACTION_STATUSES = ["OPEN", "IN_PROGRESS", "DONE", "BLOCKED"];

/**
 * Update status / owner / deadline on an action item.
 * Every changed field gets an action_history row (SPEC §4).
 */
export function updateActionItem(actionId, patch, userId = null) {
  const action = db.prepare("SELECT * FROM action_items WHERE id = ?").get(actionId);
  if (!action) throw new HttpError(404, "Action item not found");

  const next = {
    title: patch.title != null ? String(patch.title).trim() : action.title,
    description:
      patch.description != null ? String(patch.description).trim() || null : action.description,
    owner: patch.owner !== undefined ? (String(patch.owner || "").trim() || null) : action.owner,
    deadline:
      patch.deadline !== undefined
        ? (String(patch.deadline || "").trim() || null)
        : action.deadline,
    deadline_text:
      patch.deadlineText !== undefined
        ? (String(patch.deadlineText || "").trim() || null)
        : patch.deadline_text !== undefined
          ? (String(patch.deadline_text || "").trim() || null)
          : action.deadline_text,
    status: patch.status != null ? String(patch.status).trim() : action.status,
    priority: patch.priority != null ? String(patch.priority).trim() : action.priority,
  };

  if (!next.title) throw new HttpError(400, "Title is required");
  if (!ACTION_STATUSES.includes(next.status)) {
    throw new HttpError(400, `Invalid action status: ${next.status}`);
  }

  const run = db.transaction(() => {
    // Track the fields the UI cares about in history
    const tracked = [
      ["status", action.status, next.status],
      ["owner", action.owner, next.owner],
      ["deadline", action.deadline, next.deadline],
    ];
    for (const [field, oldValue, newValue] of tracked) {
      if (String(oldValue ?? "") !== String(newValue ?? "")) {
        recordActionChange(actionId, field, oldValue, newValue, userId);
      }
    }

    const completedAt =
      next.status === "DONE"
        ? action.status === "DONE"
          ? action.completed_at
          : new Date().toISOString().slice(0, 19).replace("T", " ")
        : null;

    db.prepare(
      `UPDATE action_items
       SET title = ?, description = ?, owner = ?, deadline = ?, deadline_text = ?,
           status = ?, priority = ?, completed_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      next.title,
      next.description,
      next.owner,
      next.deadline,
      next.deadline_text,
      next.status,
      next.priority,
      completedAt,
      actionId
    );

    return db.prepare("SELECT * FROM action_items WHERE id = ?").get(actionId);
  });

  return run();
}
