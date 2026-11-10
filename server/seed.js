/**
 * Demo seed (SPEC §11).
 * Run with: npm run seed   (from root or server/)
 *
 * Resets the database and creates:
 * - demo@decisionflow.app / demo1234
 * - Project "Campus Connect App"
 * - Meeting 1 "Sprint 1 Kickoff" (ENDED) with transcript + APPROVED items
 * - Meeting 2 "Sprint 2 Planning" (SCHEDULED) ready for the live demo
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import db, { DB_FILE } from "./db.js";
import { parseTranscriptText } from "./services/segments.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const demoDir = path.join(here, "..", "demo");

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD (or Date) by N calendar days. */
function addDays(base, days) {
  const d = base instanceof Date ? new Date(base) : new Date(base + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d;
}

/** Next Friday on or after `from` (weekday 5). */
function nextFriday(from) {
  const d = new Date(from + "T12:00:00");
  const day = d.getDay(); // 0=Sun … 5=Fri
  const add = day <= 5 ? 5 - day : 6; // if Sat → next Fri is +6
  return ymd(addDays(d, add === 0 ? 0 : add));
}

/** Next Wednesday strictly after `from`. */
function nextWednesday(from) {
  const d = new Date(from + "T12:00:00");
  const day = d.getDay();
  const add = ((3 - day + 7) % 7) || 7;
  return ymd(addDays(d, add));
}

function clearAll() {
  // Order matters because of foreign keys
  db.exec(`
    DELETE FROM ai_runs;
    DELETE FROM reports;
    DELETE FROM action_history;
    DELETE FROM decision_history;
    DELETE FROM relations;
    DELETE FROM questions;
    DELETE FROM blockers;
    DELETE FROM action_items;
    DELETE FROM decisions;
    DELETE FROM segments;
    DELETE FROM participants;
    DELETE FROM meetings;
    DELETE FROM projects;
    DELETE FROM users;
  `);
  // Rebuild FTS indexes (external-content tables can get out of sync after bulk delete)
  try {
    db.exec(`INSERT INTO decisions_fts(decisions_fts) VALUES('rebuild');`);
  } catch {
    /* ignore if empty */
  }
  try {
    db.exec(`INSERT INTO segments_fts(segments_fts) VALUES('rebuild');`);
  } catch {
    /* ignore if empty */
  }
}

function seed() {
  console.log(`Seeding database: ${DB_FILE}`);
  clearAll();

  const passwordHash = bcrypt.hashSync("demo1234", 10);

  // Meeting 1 was 14 days ago (SPEC §11)
  const meeting1Date = ymd(addDays(new Date(), -14));
  const meeting1Start = `${meeting1Date} 10:00:00`;
  const meeting1End = `${meeting1Date} 10:45:00`;
  const meeting2Date = ymd(addDays(new Date(), 1)); // tomorrow, scheduled

  const run = db.transaction(() => {
    // --- user ---
    const userInfo = db
      .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
      .run("Demo User", "demo@decisionflow.app", passwordHash);
    const userId = Number(userInfo.lastInsertRowid);

    // --- project ---
    const projectInfo = db
      .prepare("INSERT INTO projects (name, description) VALUES (?, ?)")
      .run(
        "Campus Connect App",
        "Student project: a campus app for notices, events and lab booking."
      );
    const projectId = Number(projectInfo.lastInsertRowid);

    // --- Meeting 1: Sprint 1 Kickoff (ENDED) ---
    const m1Info = db
      .prepare(
        `INSERT INTO meetings
           (project_id, title, agenda, scheduled_at, started_at, ended_at, status, host_user_id)
         VALUES (?, ?, ?, ?, ?, ?, 'ENDED', ?)`
      )
      .run(
        projectId,
        "Sprint 1 Kickoff",
        "Launch date, database choice, login method, owners and blockers.",
        meeting1Start,
        meeting1Start,
        meeting1End,
        userId
      );
    const meeting1Id = Number(m1Info.lastInsertRowid);

    const names = ["Priya", "Ravi", "Sneha", "Arjun"];
    const insertP = db.prepare("INSERT INTO participants (meeting_id, name) VALUES (?, ?)");
    for (const name of names) insertP.run(meeting1Id, name);

    // Transcript from demo/meeting1_kickoff.txt
    const raw = fs.readFileSync(path.join(demoDir, "meeting1_kickoff.txt"), "utf8");
    const lines = parseTranscriptText(raw);
    const insertSeg = db.prepare(
      `INSERT INTO segments (meeting_id, seq, speaker, text, source, created_at)
       VALUES (?, ?, ?, ?, 'DEMO', ?)`
    );
    const segmentIdsByQuote = new Map(); // lowercased quote snippet → [ids]
    lines.forEach((line, i) => {
      const info = insertSeg.run(
        meeting1Id,
        i + 1,
        line.speaker,
        line.text,
        meeting1Start
      );
      const id = Number(info.lastInsertRowid);
      const key = line.text.toLowerCase();
      if (!segmentIdsByQuote.has(key)) segmentIdsByQuote.set(key, []);
      segmentIdsByQuote.get(key).push(id);
    });

    function findSegmentIds(...snippets) {
      const ids = [];
      for (const [text, segs] of segmentIdsByQuote) {
        if (snippets.some((s) => text.includes(s.toLowerCase()))) {
          ids.push(...segs);
        }
      }
      return ids;
    }

    const insertDecision = db.prepare(
      `INSERT INTO decisions
         (project_id, meeting_id, title, description, topic, keywords, certainty, status,
          confidence, owner, source_quote, source_segment_ids, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, 'AGREED', 'APPROVED', ?, ?, ?, ?, ?, ?)`
    );
    const insertHistory = db.prepare(
      `INSERT INTO decision_history (decision_id, from_status, to_status, reason, changed_by, changed_at)
       VALUES (?, 'PROPOSED', 'APPROVED', ?, ?, ?)`
    );

    // Three APPROVED decisions from Meeting 1
    const decisions = [
      {
        title: "Launch the beta on 15 March",
        description: "The team agreed to launch the Campus Connect beta on 15 March.",
        topic: "launch date",
        keywords: ["beta", "launch", "march", "date"],
        quote: "We've decided to launch the beta on 15 March.",
        snippet: "launch the beta on 15 march",
      },
      {
        title: "Use SQLite for the prototype database",
        description: "Prototype will use SQLite so students can run it without installing a DB server.",
        topic: "database",
        keywords: ["sqlite", "database", "prototype"],
        quote: "We've decided to use SQLite for the prototype database.",
        snippet: "use sqlite for the prototype",
      },
      {
        title: "Login will support email OTP only",
        description: "For the prototype, login is email OTP only — no Google sign-in yet.",
        topic: "login method",
        keywords: ["login", "email", "otp", "auth"],
        quote: "We've decided — login will support email OTP only.",
        snippet: "email otp only",
      },
    ];

    for (const d of decisions) {
      const segIds = findSegmentIds(d.snippet);
      const info = insertDecision.run(
        projectId,
        meeting1Id,
        d.title,
        d.description,
        d.topic,
        JSON.stringify(d.keywords),
        0.95,
        null,
        d.quote,
        JSON.stringify(segIds),
        userId,
        meeting1End
      );
      const decisionId = Number(info.lastInsertRowid);
      insertHistory.run(
        decisionId,
        "Approved during Sprint 1 Kickoff (seed)",
        userId,
        meeting1End
      );
    }

    // Action items
    const friday = nextFriday(meeting1Date);
    const wednesday = nextWednesday(meeting1Date);
    const insertAction = db.prepare(
      `INSERT INTO action_items
         (project_id, meeting_id, title, description, owner, deadline, deadline_text,
          status, priority, confidence, source_quote, source_segment_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', 'MEDIUM', ?, ?, ?)`
    );
    const insertActionHist = db.prepare(
      `INSERT INTO action_history (action_id, field, old_value, new_value, changed_by, changed_at)
       VALUES (?, 'status', NULL, 'OPEN', ?, ?)`
    );

    const actions = [
      {
        title: "Ravi to finish login API by Friday",
        description: "Finish the login API (email OTP) by end of Friday.",
        owner: "Ravi",
        deadline: friday,
        deadlineText: "by Friday",
        quote: "Ravi will finish the login API by Friday.",
        snippet: "finish the login api by friday",
      },
      {
        title: "Sneha to design onboarding screens by next Wednesday",
        description: "Design onboarding screens and share Figma links.",
        owner: "Sneha",
        deadline: wednesday,
        deadlineText: "by next Wednesday",
        quote: "Sneha will design onboarding screens by next Wednesday.",
        snippet: "design onboarding screens",
      },
    ];

    for (const a of actions) {
      const segIds = findSegmentIds(a.snippet);
      const info = insertAction.run(
        projectId,
        meeting1Id,
        a.title,
        a.description,
        a.owner,
        a.deadline,
        a.deadlineText,
        0.9,
        a.quote,
        JSON.stringify(segIds)
      );
      insertActionHist.run(Number(info.lastInsertRowid), userId, meeting1End);
    }

    // Blocker
    const blockerSegs = findSegmentIds("waiting for college smtp");
    db.prepare(
      `INSERT INTO blockers
         (project_id, meeting_id, description, owner, keywords, group_id, resolved, source_quote)
       VALUES (?, ?, ?, ?, ?, NULL, 0, ?)`
    ).run(
      projectId,
      meeting1Id,
      "Waiting for college SMTP server access",
      "Ravi",
      JSON.stringify(["smtp", "college", "access", "email"]),
      "we are waiting for college SMTP server access."
    );
    // Set group_id to its own id (first of a recurring group)
    const blocker = db
      .prepare("SELECT id FROM blockers WHERE meeting_id = ? ORDER BY id DESC LIMIT 1")
      .get(meeting1Id);
    db.prepare("UPDATE blockers SET group_id = ? WHERE id = ?").run(blocker.id, blocker.id);
    // silence unused var warning for segment lookup used above
    void blockerSegs;

    // --- Meeting 2: Sprint 2 Planning (SCHEDULED) — run live in the demo ---
    const m2Info = db
      .prepare(
        `INSERT INTO meetings
           (project_id, title, agenda, scheduled_at, status, host_user_id)
         VALUES (?, ?, ?, ?, 'SCHEDULED', ?)`
      )
      .run(
        projectId,
        "Sprint 2 Planning",
        "Follow-up on launch date, login method, SMTP blocker, and next actions.",
        `${meeting2Date} 10:00:00`,
        userId
      );
    const meeting2Id = Number(m2Info.lastInsertRowid);
    for (const name of names) insertP.run(meeting2Id, name);

    return { userId, projectId, meeting1Id, meeting2Id };
  });

  const ids = run();
  console.log("Seed complete.");
  console.log(`  Login:  demo@decisionflow.app / demo1234`);
  console.log(`  Project id: ${ids.projectId}`);
  console.log(`  Meeting 1 (ENDED): ${ids.meeting1Id} — Sprint 1 Kickoff`);
  console.log(`  Meeting 2 (SCHEDULED): ${ids.meeting2Id} — Sprint 2 Planning`);
}

seed();
