// Meetings API: create, list, open, start/end, upload transcript, play demo scripts.
// See docs/SPEC.md §9.
import { Router } from "express";
import multer from "multer";
import mammoth from "mammoth";
import db from "../db.js";
import { HttpError, handle } from "../middleware/errors.js";
import { emitToMeeting } from "../services/realtime.js";
import { listSegments, parseTranscriptText, saveFinalSegment } from "../services/segments.js";
import { listDemoFiles, playDemo, stopDemo } from "../services/demoPlayer.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

function getMeetingOrThrow(id) {
  const meeting = db.prepare("SELECT * FROM meetings WHERE id = ?").get(id);
  if (!meeting) throw new HttpError(404, "Meeting not found");
  return meeting;
}

function participantsOf(meetingId) {
  return db
    .prepare("SELECT id, name FROM participants WHERE meeting_id = ? ORDER BY id")
    .all(meetingId);
}

/** Shape returned by GET /meetings/:id (items stay empty until Step 4/5). */
function meetingDetail(meeting) {
  return {
    ...meeting,
    participants: participantsOf(meeting.id),
    transcript: listSegments(meeting.id),
    decisions: [],
    actionItems: [],
    blockers: [],
    questions: [],
    relations: [],
  };
}

// --------------------------------------------------------------------------- list
router.get("/", (req, res) => {
  const { projectId, status } = req.query;
  if (!projectId) throw new HttpError(400, "projectId is required");

  const allowed = ["SCHEDULED", "LIVE", "ENDED"];
  let sql = `SELECT m.*,
      (SELECT COUNT(*) FROM participants p WHERE p.meeting_id = m.id) AS participant_count,
      (SELECT COUNT(*) FROM segments s WHERE s.meeting_id = m.id) AS segment_count
    FROM meetings m WHERE m.project_id = ?`;
  const params = [Number(projectId)];

  if (status) {
    if (!allowed.includes(status)) throw new HttpError(400, "Invalid status filter");
    sql += " AND m.status = ?";
    params.push(status);
  }

  sql += " ORDER BY COALESCE(m.scheduled_at, m.created_at) DESC, m.id DESC";
  res.json(db.prepare(sql).all(...params));
});

// Demo file names for the Live Meeting dropdown (must be before /:id)
router.get("/demo-files", (_req, res) => {
  res.json(listDemoFiles());
});

// --------------------------------------------------------------------------- create
router.post("/", (req, res) => {
  const projectId = Number(req.body.projectId);
  const title = (req.body.title || "").trim();
  const agenda = (req.body.agenda || "").trim() || null;
  const scheduledAt = (req.body.scheduledAt || "").trim() || null;
  const names = Array.isArray(req.body.participants)
    ? req.body.participants.map((n) => String(n).trim()).filter(Boolean)
    : [];

  if (!projectId || !title) throw new HttpError(400, "projectId and title are required");
  const project = db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId);
  if (!project) throw new HttpError(404, "Project not found");

  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO meetings (project_id, title, agenda, scheduled_at, host_user_id, status)
         VALUES (?, ?, ?, ?, ?, 'SCHEDULED')`
      )
      .run(projectId, title, agenda, scheduledAt, req.user.id);

    const meetingId = Number(info.lastInsertRowid);
    const insertP = db.prepare("INSERT INTO participants (meeting_id, name) VALUES (?, ?)");
    for (const name of names) insertP.run(meetingId, name);
    return meetingId;
  });

  const meetingId = create();
  res.status(201).json(meetingDetail(getMeetingOrThrow(meetingId)));
});

// --------------------------------------------------------------------------- get one
router.get("/:id", (req, res) => {
  res.json(meetingDetail(getMeetingOrThrow(Number(req.params.id))));
});

// --------------------------------------------------------------------------- start / end
router.post("/:id/start", (req, res) => {
  const meeting = getMeetingOrThrow(Number(req.params.id));
  if (meeting.status !== "SCHEDULED") {
    throw new HttpError(409, `Cannot start a meeting that is ${meeting.status}`);
  }

  db.prepare(
    `UPDATE meetings SET status = 'LIVE', started_at = datetime('now') WHERE id = ?`
  ).run(meeting.id);

  const updated = getMeetingOrThrow(meeting.id);
  emitToMeeting(meeting.id, "meeting:status", { status: "LIVE" });
  res.json(meetingDetail(updated));
});

router.post("/:id/end", (req, res) => {
  const meeting = getMeetingOrThrow(Number(req.params.id));
  if (meeting.status !== "LIVE") {
    throw new HttpError(409, `Cannot end a meeting that is ${meeting.status}`);
  }

  // Stop any running demo so lines don't keep appearing after End
  stopDemo(meeting.id);

  db.prepare(
    `UPDATE meetings SET status = 'ENDED', ended_at = datetime('now') WHERE id = ?`
  ).run(meeting.id);

  const updated = getMeetingOrThrow(meeting.id);
  emitToMeeting(meeting.id, "meeting:status", { status: "ENDED" });
  res.json(meetingDetail(updated));
});

// --------------------------------------------------------------------------- upload .txt / .docx
router.post(
  "/:id/upload",
  upload.single("file"),
  handle(async (req, res) => {
    const meeting = getMeetingOrThrow(Number(req.params.id));
    if (meeting.status !== "LIVE") {
      throw new HttpError(409, "Upload is only allowed while the meeting is LIVE");
    }
    if (!req.file) throw new HttpError(400, "Please attach a .txt or .docx file");

    const name = (req.file.originalname || "").toLowerCase();
    let text = "";
    if (name.endsWith(".txt") || req.file.mimetype === "text/plain") {
      text = req.file.buffer.toString("utf8");
    } else if (name.endsWith(".docx") || req.file.mimetype.includes("wordprocessingml")) {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      text = result.value;
    } else {
      throw new HttpError(400, "Only .txt and .docx files are supported");
    }

    const lines = parseTranscriptText(text);
    if (lines.length === 0) throw new HttpError(400, "No transcript lines found in the file");

    const saved = [];
    const insertAll = db.transaction(() => {
      for (const line of lines) {
        const segment = saveFinalSegment(meeting.id, {
          text: line.text,
          speaker: line.speaker,
          source: "UPLOAD",
        });
        if (segment) saved.push(segment);
      }
    });
    insertAll();

    // Push each line to everyone currently watching the meeting
    for (const segment of saved) {
      emitToMeeting(meeting.id, "transcript:final", { segment });
    }

    res.json({ imported: saved.length, segments: saved });
  })
);

// --------------------------------------------------------------------------- demo play / stop
router.post("/:id/demo/play", (req, res) => {
  const meeting = getMeetingOrThrow(Number(req.params.id));
  if (meeting.status !== "LIVE") {
    throw new HttpError(409, "Demo playback is only allowed while the meeting is LIVE");
  }
  const result = playDemo(meeting.id, req.body.file, req.body.speed);
  res.json(result);
});

router.post("/:id/demo/stop", (req, res) => {
  const meeting = getMeetingOrThrow(Number(req.params.id));
  const stopped = stopDemo(meeting.id);
  res.json({ stopped });
});

export default router;
