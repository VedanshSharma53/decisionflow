/**
 * Meeting summary + template reports (SPEC §8.5).
 * Meeting end calls generateMeetingReport(). Mock mode builds Markdown from the DB.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../db.js";
import { askClaude, isMockMode, logMockRun } from "./ai.js";
import { SummarySchema } from "./schemas.js";
import {
  listMeetingActions,
  listMeetingBlockers,
  listMeetingDecisions,
  listMeetingQuestions,
  shapeDecision,
} from "./items.js";

const PROMPT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "prompts", "summary.md");
const SYSTEM_PROMPT = fs.readFileSync(PROMPT_PATH, "utf8");

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

function meetingPayload(meetingId) {
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(meetingId);
  if (!meeting) return null;

  const decisions = listMeetingDecisions(meetingId);
  const actionItems = listMeetingActions(meetingId);
  const blockers = listMeetingBlockers(meetingId);
  const questions = listMeetingQuestions(meetingId);

  const relations = db
    .prepare(
      `SELECT r.*, od.title AS old_title, nd.title AS new_title
       FROM relations r
       JOIN decisions nd ON nd.id = r.new_decision_id
       JOIN decisions od ON od.id = r.old_decision_id
       WHERE nd.meeting_id = ?
       ORDER BY r.id ASC`
    )
    .all(meetingId);

  return { meeting, decisions, actionItems, blockers, questions, relations };
}

/** Template Markdown used in mock mode (and as a safe fallback). */
export function buildTemplateSummary(meetingId) {
  const data = meetingPayload(meetingId);
  if (!data) return "# Meeting report\n\nMeeting not found.\n";

  const { meeting, decisions, actionItems, blockers, questions, relations } = data;
  const lines = [];

  lines.push(`# ${meeting.title}`);
  lines.push("");
  lines.push(`*Generated ${todayYmd()} · status ${meeting.status}*`);
  lines.push("");

  lines.push("## Overview");
  lines.push(
    [
      `This meeting produced ${decisions.length} decision(s), ${actionItems.length} action item(s),`,
      `${blockers.length} blocker(s) and ${questions.length} open question(s).`,
      relations.length
        ? `${relations.length} possible change(s) to earlier decisions were flagged for review.`
        : "No changes to earlier decisions were flagged.",
    ].join(" ")
  );
  lines.push("");

  lines.push("## Key Decisions");
  if (decisions.length === 0) lines.push("- None.");
  else {
    for (const d of decisions) {
      lines.push(`- **${d.title}** (${d.status}${d.certainty ? `, ${d.certainty}` : ""})`);
    }
  }
  lines.push("");

  lines.push("## Action Items");
  lines.push("");
  lines.push("| Title | Owner | Deadline | Status |");
  lines.push("| --- | --- | --- | --- |");
  if (actionItems.length === 0) {
    lines.push("| — | — | — | — |");
  } else {
    for (const a of actionItems) {
      lines.push(
        `| ${a.title.replace(/\|/g, "/")} | ${a.owner || "—"} | ${a.deadline || a.deadline_text || "—"} | ${a.status} |`
      );
    }
  }
  lines.push("");

  lines.push("## Blockers");
  if (blockers.length === 0) lines.push("- None.");
  else {
    for (const b of blockers) {
      lines.push(`- ${b.description}${b.resolved ? " *(resolved)*" : ""}`);
    }
  }
  lines.push("");

  lines.push("## Open Questions");
  if (questions.length === 0) lines.push("- None.");
  else {
    for (const q of questions) {
      lines.push(`- ${q.question}${q.resolved ? " *(resolved)*" : ""}`);
    }
  }
  lines.push("");

  lines.push("## Changes to Earlier Decisions");
  if (relations.length === 0) lines.push("None.");
  else {
    for (const r of relations) {
      lines.push(
        `- **${r.type}** (${r.review_status}): "${r.new_title}" vs earlier "${r.old_title}"${
          r.explanation ? ` — ${r.explanation}` : ""
        }`
      );
    }
  }
  lines.push("");

  lines.push("## Follow-ups for the Next Meeting");
  const openActions = actionItems.filter((a) => a.status !== "DONE");
  const openBlockers = blockers.filter((b) => !b.resolved);
  const openQs = questions.filter((q) => !q.resolved);
  if (openActions.length === 0 && openBlockers.length === 0 && openQs.length === 0) {
    lines.push("- Confirm all approved decisions are reflected in the project plan.");
  } else {
    for (const a of openActions.slice(0, 4)) {
      lines.push(`- Follow up on action: ${a.title}${a.owner ? ` (${a.owner})` : ""}`);
    }
    for (const b of openBlockers.slice(0, 2)) {
      lines.push(`- Unblock: ${b.description}`);
    }
    for (const q of openQs.slice(0, 2)) {
      lines.push(`- Answer: ${q.question}`);
    }
  }
  lines.push("");

  return lines.join("\n");
}

function saveReport(meetingId, markdown) {
  db.prepare(
    `INSERT INTO reports (meeting_id, summary_md, created_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(meeting_id) DO UPDATE SET
       summary_md = excluded.summary_md,
       created_at = excluded.created_at`
  ).run(meetingId, markdown);

  return db.prepare("SELECT * FROM reports WHERE meeting_id = ?").get(meetingId);
}

/** Generate (or regenerate) the meeting summary and store it. */
export async function generateMeetingReport(meetingId) {
  const data = meetingPayload(meetingId);
  if (!data) throw new Error("Meeting not found");

  const started = Date.now();
  let markdown;

  if (isMockMode()) {
    markdown = buildTemplateSummary(meetingId);
    logMockRun({ meetingId, kind: "SUMMARY", latencyMs: Date.now() - started });
  } else {
    const user = [
      `Meeting: ${data.meeting.title}`,
      `Agenda: ${data.meeting.agenda || "(none)"}`,
      "",
      "ITEMS (JSON):",
      JSON.stringify(
        {
          decisions: data.decisions.map((d) => ({
            title: d.title,
            status: d.status,
            certainty: d.certainty,
            description: d.description,
          })),
          actionItems: data.actionItems.map((a) => ({
            title: a.title,
            owner: a.owner,
            deadline: a.deadline,
            status: a.status,
          })),
          blockers: data.blockers.map((b) => ({
            description: b.description,
            resolved: Boolean(b.resolved),
          })),
          questions: data.questions.map((q) => ({
            question: q.question,
            resolved: Boolean(q.resolved),
          })),
          relations: data.relations.map((r) => ({
            type: r.type,
            review_status: r.review_status,
            old_title: r.old_title,
            new_title: r.new_title,
            explanation: r.explanation,
          })),
        },
        null,
        2
      ),
    ].join("\n");

    const result = await askClaude({
      system: SYSTEM_PROMPT,
      user,
      schema: SummarySchema,
      effort: "medium",
      meetingId,
      kind: "SUMMARY",
    });
    markdown = result.markdown;
  }

  return saveReport(meetingId, markdown);
}

export function getMeetingReport(meetingId) {
  return db.prepare("SELECT * FROM reports WHERE meeting_id = ?").get(meetingId) || null;
}

/** Template Decision Log for a project. */
export function buildDecisionLog(projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  const decisions = db
    .prepare(
      `SELECT d.*, m.title AS meeting_title
       FROM decisions d
       JOIN meetings m ON m.id = d.meeting_id
       WHERE d.project_id = ?
       ORDER BY d.created_at DESC, d.id DESC`
    )
    .all(projectId)
    .map(shapeDecision);

  const lines = [
    `# Decision Log — ${project?.name || "Project"}`,
    "",
    `*Generated ${todayYmd()} · ${decisions.length} decision(s)*`,
    "",
  ];

  for (const d of decisions) {
    lines.push(`## ${d.title}`);
    lines.push("");
    lines.push(`- **Status:** ${d.status}`);
    lines.push(`- **Certainty:** ${d.certainty || "—"}`);
    lines.push(`- **Meeting:** ${d.meeting_title}`);
    lines.push(`- **Topic:** ${d.topic || "—"}`);
    if (d.description) lines.push(`- **Description:** ${d.description}`);
    if (d.source_quote) lines.push(`- **Quote:** “${d.source_quote}”`);

    const history = db
      .prepare(
        `SELECT * FROM decision_history WHERE decision_id = ? ORDER BY changed_at ASC, id ASC`
      )
      .all(d.id);
    if (history.length) {
      lines.push("- **History:**");
      for (const h of history) {
        lines.push(
          `  - ${h.from_status || "∅"} → ${h.to_status}${h.reason ? ` (${h.reason})` : ""} · ${h.changed_at}`
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** Template Action Item Report — overdue first, grouped by owner. */
export function buildActionReport(projectId) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  const today = todayYmd();
  const actions = db
    .prepare(
      `SELECT a.*, m.title AS meeting_title
       FROM action_items a
       JOIN meetings m ON m.id = a.meeting_id
       WHERE a.project_id = ?
       ORDER BY a.owner IS NULL, LOWER(a.owner), a.deadline IS NULL, a.deadline ASC, a.id ASC`
    )
    .all(projectId);

  const withFlags = actions.map((a) => ({
    ...a,
    overdue: Boolean(a.deadline) && a.status !== "DONE" && a.deadline < today,
  }));

  // Overdue first overall, then group by owner
  withFlags.sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    const oa = (a.owner || "Unassigned").toLowerCase();
    const ob = (b.owner || "Unassigned").toLowerCase();
    if (oa !== ob) return oa.localeCompare(ob);
    return (a.deadline || "").localeCompare(b.deadline || "");
  });

  const lines = [
    `# Action Item Report — ${project?.name || "Project"}`,
    "",
    `*Generated ${today} · ${withFlags.length} item(s)*`,
    "",
  ];

  let currentOwner = null;
  for (const a of withFlags) {
    const owner = a.owner || "Unassigned";
    if (owner !== currentOwner) {
      currentOwner = owner;
      lines.push(`## ${owner}`);
      lines.push("");
    }
    const flag = a.overdue ? " **OVERDUE**" : "";
    lines.push(
      `- **${a.title}** — ${a.status}${flag}; deadline ${a.deadline || a.deadline_text || "—"}; meeting: ${a.meeting_title}`
    );
  }

  if (withFlags.length === 0) lines.push("_No action items._");
  lines.push("");
  return lines.join("\n");
}
