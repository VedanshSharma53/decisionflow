// GET /api/projects, POST /api/projects
// A "project" groups meetings, so decisions can be compared across meetings of the same team.
import { Router } from "express";
import db from "../db.js";
import { HttpError } from "../middleware/errors.js";

const router = Router();

router.get("/", (req, res) => {
  const projects = db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM meetings m WHERE m.project_id = p.id) AS meeting_count
       FROM projects p ORDER BY p.created_at DESC, p.id DESC`
    )
    .all();
  res.json(projects);
});

router.post("/", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) throw new HttpError(400, "Project name is required");
  const info = db
    .prepare("INSERT INTO projects (name, description) VALUES (?, ?)")
    .run(name, (req.body.description || "").trim() || null);
  res.status(201).json(db.prepare("SELECT * FROM projects WHERE id = ?").get(info.lastInsertRowid));
});

export default router;
