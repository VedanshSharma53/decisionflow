// Insights API for Dashboard + Insights page (SPEC §9, §10.2 / §10.9).
import { Router } from "express";
import db from "../db.js";
import { HttpError } from "../middleware/errors.js";
import { listRecurringBlockerGroups } from "../services/blockers.js";

const router = Router();

function todayYmd() {
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

function weekAgoYmd() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  const tz = process.env.TIMEZONE || "Asia/Kolkata";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function projectInsights(projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  if (!project) throw new HttpError(404, "Project not found");

  const today = todayYmd();
  const weekAgo = weekAgoYmd();

  const openActions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM action_items
       WHERE project_id = ? AND status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')`
    )
    .get(projectId).n;

  const overdueActions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM action_items
       WHERE project_id = ? AND deadline IS NOT NULL AND deadline < ? AND status != 'DONE'`
    )
    .get(projectId, today).n;

  const pendingReviews = db
    .prepare(
      `SELECT COUNT(*) AS n FROM relations r
       JOIN decisions nd ON nd.id = r.new_decision_id
       WHERE nd.project_id = ? AND r.review_status = 'PENDING'`
    )
    .get(projectId).n;

  const decisionsThisWeek = db
    .prepare(
      `SELECT COUNT(*) AS n FROM decisions
       WHERE project_id = ? AND date(created_at) >= date(?)`
    )
    .get(projectId, weekAgo).n;

  // Actions per owner for stacked bar chart
  const actionRows = db
    .prepare(
      `SELECT COALESCE(owner, 'Unassigned') AS owner, status, deadline
       FROM action_items WHERE project_id = ?`
    )
    .all(projectId);

  const byOwner = new Map();
  for (const a of actionRows) {
    if (!byOwner.has(a.owner)) {
      byOwner.set(a.owner, { owner: a.owner, open: 0, done: 0, overdue: 0 });
    }
    const row = byOwner.get(a.owner);
    if (a.status === "DONE") row.done += 1;
    else {
      row.open += 1;
      if (a.deadline && a.deadline < today) row.overdue += 1;
    }
  }

  const decisionStatuses = db
    .prepare(
      `SELECT status, COUNT(*) AS count FROM decisions WHERE project_id = ? GROUP BY status`
    )
    .all(projectId);

  const decisionsPerMeeting = db
    .prepare(
      `SELECT m.id AS meetingId, m.title AS meetingTitle,
              COALESCE(m.scheduled_at, m.started_at, m.created_at) AS meetingDate,
              COUNT(d.id) AS count
       FROM meetings m
       LEFT JOIN decisions d ON d.meeting_id = m.id
       WHERE m.project_id = ?
       GROUP BY m.id
       ORDER BY meetingDate ASC, m.id ASC`
    )
    .all(projectId);

  const totalActions = actionRows.length;
  const withOwnerAndDeadline = actionRows.filter((a) => a.owner && a.deadline).length;
  const accountabilityScore =
    totalActions === 0 ? 100 : Math.round((withOwnerAndDeadline / totalActions) * 100);

  const recurringBlockers = listRecurringBlockerGroups(projectId);

  const myActionItems = db
    .prepare(
      `SELECT a.*, m.title AS meeting_title
       FROM action_items a
       JOIN meetings m ON m.id = a.meeting_id
       WHERE a.project_id = ? AND a.status != 'DONE'
       ORDER BY
         CASE WHEN a.deadline IS NOT NULL AND a.deadline < ? THEN 0 ELSE 1 END,
         a.deadline IS NULL, a.deadline ASC, a.id DESC
       LIMIT 10`
    )
    .all(projectId, today)
    .map((a) => ({
      ...a,
      overdue: Boolean(a.deadline) && a.deadline < today,
    }));

  const recentMeetings = db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM decisions d WHERE d.meeting_id = m.id) AS decision_count,
              (SELECT COUNT(*) FROM action_items a WHERE a.meeting_id = m.id) AS action_count
       FROM meetings m
       WHERE m.project_id = ?
       ORDER BY COALESCE(m.scheduled_at, m.started_at, m.created_at) DESC, m.id DESC
       LIMIT 6`
    )
    .all(projectId);

  return {
    project,
    stats: {
      openActions,
      overdueActions,
      pendingReviews,
      decisionsThisWeek,
      accountabilityScore,
      totalActions,
      withOwnerAndDeadline,
    },
    actionsPerOwner: [...byOwner.values()],
    decisionStatuses,
    decisionsPerMeeting,
    recurringBlockers,
    myActionItems,
    recentMeetings,
  };
}

// GET /api/insights/project/:id
router.get("/project/:id", (req, res) => {
  res.json(projectInsights(Number(req.params.id)));
});

// GET /api/insights/meeting/:id  — lighter per-meeting snapshot
router.get("/meeting/:id", (req, res) => {
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(Number(req.params.id));
  if (!meeting) throw new HttpError(404, "Meeting not found");

  const decisions = db
    .prepare(`SELECT status, COUNT(*) AS count FROM decisions WHERE meeting_id = ? GROUP BY status`)
    .all(meeting.id);
  const actions = db
    .prepare(`SELECT status, COUNT(*) AS count FROM action_items WHERE meeting_id = ? GROUP BY status`)
    .all(meeting.id);
  const blockers = db
    .prepare(`SELECT COUNT(*) AS n FROM blockers WHERE meeting_id = ?`).get(meeting.id).n;
  const questions = db
    .prepare(`SELECT COUNT(*) AS n FROM questions WHERE meeting_id = ?`).get(meeting.id).n;

  res.json({ meeting, decisions, actions, blockers, questions });
});

export default router;
