// Project-level template reports (SPEC §8.5 / §9).
import { Router } from "express";
import { HttpError } from "../middleware/errors.js";
import { buildActionReport, buildDecisionLog } from "../services/reports.js";

const router = Router();

// GET /api/reports/decision-log?projectId=
router.get("/decision-log", (req, res) => {
  const projectId = Number(req.query.projectId);
  if (!projectId) throw new HttpError(400, "projectId is required");
  const markdown = buildDecisionLog(projectId);
  res.json({ markdown, projectId });
});

// GET /api/reports/actions?projectId=
router.get("/actions", (req, res) => {
  const projectId = Number(req.query.projectId);
  if (!projectId) throw new HttpError(400, "projectId is required");
  const markdown = buildActionReport(projectId);
  res.json({ markdown, projectId });
});

export default router;
