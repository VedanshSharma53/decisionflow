// DecisionFlow API server: Express (REST API) + Socket.IO (live updates) on one port.
import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import { DB_FILE } from "./db.js";
import { requireAuth } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { initRealtime } from "./services/realtime.js";
import authRoutes from "./routes/auth.js";
import projectRoutes from "./routes/projects.js";
import meetingRoutes from "./routes/meetings.js";
import decisionRoutes from "./routes/decisions.js";
import actionRoutes from "./routes/actions.js";
import relationRoutes from "./routes/relations.js";
import blockerRoutes from "./routes/blockers.js";
import insightRoutes from "./routes/insights.js";
import reportRoutes from "./routes/reports.js";
import searchRoutes from "./routes/search.js";
import { startExtractionLoop } from "./services/extraction.js";
import { isMockMode } from "./services/ai.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) =>
  res.json({ ok: true, aiMode: isMockMode() ? "mock" : process.env.AI_MODE || "claude" })
);

// Public routes
app.use("/api/auth", authRoutes);

// Everything below needs a login token
app.use("/api", requireAuth);
app.use("/api/projects", projectRoutes);
app.use("/api/meetings", meetingRoutes);
app.use("/api/decisions", decisionRoutes);
app.use("/api/actions", actionRoutes);
app.use("/api/relations", relationRoutes);
app.use("/api/blockers", blockerRoutes);
app.use("/api/insights", insightRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/search", searchRoutes);

app.use("/api", notFound);
app.use(errorHandler);

const server = http.createServer(app);
initRealtime(server);
startExtractionLoop();

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`DecisionFlow server running on http://localhost:${PORT}`);
  console.log(`Database file: ${DB_FILE}`);
  console.log(`AI mode: ${isMockMode() ? "mock" : process.env.AI_MODE || "claude"}`);
});
