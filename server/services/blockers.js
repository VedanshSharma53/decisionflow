/**
 * Recurring-blocker detection (SPEC §8.4).
 * When a new blocker is saved, compare it with blockers from OTHER meetings
 * in the same project. Similarity threshold 0.3 on keywords + description.
 */
import db from "../db.js";
import { scoreText } from "./similarity.js";
import { emitToMeeting } from "./realtime.js";
import { shapeBlocker } from "./items.js";

function parseKeywords(row) {
  if (Array.isArray(row.keywords)) return row.keywords;
  try {
    return row.keywords ? JSON.parse(row.keywords) : [];
  } catch {
    return [];
  }
}

/**
 * After a blocker is inserted, find a similar earlier blocker and join its group.
 * Emits blocker:recurring when a match is found.
 */
export function checkRecurring(blocker) {
  if (!blocker?.id || !blocker.project_id) return null;

  const fresh = db.prepare("SELECT * FROM blockers WHERE id = ?").get(blocker.id);
  if (!fresh) return null;

  const keywords = parseKeywords(fresh);
  const others = db
    .prepare(
      `SELECT * FROM blockers
       WHERE project_id = ? AND meeting_id != ? AND id != ?
       ORDER BY id ASC`
    )
    .all(fresh.project_id, fresh.meeting_id, fresh.id);

  let best = null;
  let bestScore = 0;
  for (const other of others) {
    const score = scoreText(
      fresh.description,
      other.description,
      keywords,
      parseKeywords(other)
    );
    if (score >= 0.3 && score > bestScore) {
      best = other;
      bestScore = score;
    }
  }

  if (!best) {
    // First of its kind — own group
    if (fresh.group_id == null) {
      db.prepare("UPDATE blockers SET group_id = ? WHERE id = ?").run(fresh.id, fresh.id);
    }
    return null;
  }

  const groupId = best.group_id || best.id;
  db.prepare("UPDATE blockers SET group_id = ? WHERE id = ?").run(groupId, fresh.id);
  // Ensure the matched blocker also points at the group root
  if (best.group_id == null) {
    db.prepare("UPDATE blockers SET group_id = ? WHERE id = ?").run(groupId, best.id);
  }

  // Previous meetings in this group (excluding the current meeting)
  const previousMeetings = db
    .prepare(
      `SELECT DISTINCT m.id, m.title,
              COALESCE(m.scheduled_at, m.started_at, m.created_at) AS date
       FROM blockers b
       JOIN meetings m ON m.id = b.meeting_id
       WHERE b.group_id = ? AND b.meeting_id != ?
       ORDER BY date ASC`
    )
    .all(groupId, fresh.meeting_id);

  const updated = shapeBlocker(db.prepare("SELECT * FROM blockers WHERE id = ?").get(fresh.id));

  emitToMeeting(fresh.meeting_id, "blocker:recurring", {
    blocker: updated,
    previousMeetings,
    message:
      previousMeetings.length > 0
        ? `Also raised in '${previousMeetings.map((m) => m.title).join("', '")}'`
        : "Similar blocker seen before",
  });

  return { blocker: updated, previousMeetings, score: bestScore };
}

/**
 * Groups that appear in 2+ meetings — used by Insights / Dashboard.
 */
export function listRecurringBlockerGroups(projectId) {
  const rows = db
    .prepare(
      `SELECT b.group_id,
              COUNT(DISTINCT b.meeting_id) AS meeting_count,
              COUNT(*) AS mention_count,
              MIN(b.id) AS first_id
       FROM blockers b
       WHERE b.project_id = ? AND b.group_id IS NOT NULL
       GROUP BY b.group_id
       HAVING COUNT(DISTINCT b.meeting_id) >= 2
       ORDER BY meeting_count DESC, first_id ASC`
    )
    .all(projectId);

  return rows.map((g) => {
    const members = db
      .prepare(
        `SELECT b.*, m.title AS meeting_title,
                COALESCE(m.scheduled_at, m.started_at, m.created_at) AS meeting_date
         FROM blockers b
         JOIN meetings m ON m.id = b.meeting_id
         WHERE b.group_id = ?
         ORDER BY b.id ASC`
      )
      .all(g.group_id)
      .map(shapeBlocker);

    const root = members[0];
    const meetings = [];
    const seen = new Set();
    for (const m of members) {
      if (seen.has(m.meeting_id)) continue;
      seen.add(m.meeting_id);
      meetings.push({
        id: m.meeting_id,
        title: m.meeting_title,
        date: m.meeting_date,
      });
    }

    return {
      groupId: g.group_id,
      description: root?.description || "",
      owner: root?.owner || null,
      resolved: members.every((m) => m.resolved),
      meetingCount: g.meeting_count,
      mentionCount: g.mention_count,
      meetings,
      members,
    };
  });
}
