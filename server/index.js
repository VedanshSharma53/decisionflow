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

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (req, res) => res.json({ ok: true, aiMode: process.env.AI_MODE || "mock" }));

// Public routes
app.use("/api/auth", authRoutes);

// Everything below needs a login token
app.use("/api", requireAuth);
app.use("/api/projects", projectRoutes);

app.use("/api", notFound);
app.use(errorHandler);

const server = http.createServer(app);
initRealtime(server);

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`DecisionFlow server running on http://localhost:${PORT}`);
  console.log(`Database file: ${DB_FILE}`);
  console.log(`AI mode: ${process.env.AI_MODE || "mock"}`);
});
