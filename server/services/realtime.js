// Real-time updates with Socket.IO. Every meeting is a room named meeting:<id>.
// Event table: docs/SPEC.md section 6.
import { Server } from "socket.io";
import db from "../db.js";
import { verifyToken } from "../middleware/auth.js";
import { listSegments, saveFinalSegment } from "./segments.js";

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: true } });

  // Only logged-in users may connect: the client passes its token in io(url, { auth: { token } })
  io.use((socket, next) => {
    try {
      socket.user = verifyToken(socket.handshake.auth?.token);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`[socket] ${socket.user.name} connected`);

    // Join a meeting room and get the transcript so far (ack callback).
    socket.on("meeting:join", ({ meetingId }, ack) => {
      const id = Number(meetingId);
      const meeting = db.prepare("SELECT id, status FROM meetings WHERE id = ?").get(id);
      if (!meeting) {
        if (typeof ack === "function") ack({ error: "Meeting not found" });
        return;
      }
      socket.join(`meeting:${id}`);
      socket.meetingId = id;
      const transcript = listSegments(id);
      if (typeof ack === "function") ack({ meetingId: id, status: meeting.status, transcript });
    });

    // Live partial text from the mic — not saved, just relayed to everyone in the room.
    socket.on("segment:interim", ({ meetingId, text, speaker }) => {
      const id = Number(meetingId);
      if (!id || !text) return;
      emitToMeeting(id, "transcript:interim", {
        text,
        speaker: speaker || "Speaker",
      });
    });

    // Final spoken / typed line — save it, then push to everyone in the room.
    socket.on("segment:final", ({ meetingId, text, speaker, source }) => {
      const id = Number(meetingId);
      const meeting = db.prepare("SELECT id, status FROM meetings WHERE id = ?").get(id);
      if (!meeting || meeting.status !== "LIVE") return;

      const segment = saveFinalSegment(id, {
        text,
        speaker: speaker || "Speaker",
        source: source || "MIC",
      });
      if (!segment) return;
      emitToMeeting(id, "transcript:final", { segment });
    });

    socket.on("disconnect", () => {
      console.log(`[socket] ${socket.user.name} disconnected`);
    });
  });

  return io;
}

/** Send an event to everyone currently viewing a meeting. */
export function emitToMeeting(meetingId, event, data) {
  if (io) io.to(`meeting:${meetingId}`).emit(event, data);
}

export const getIO = () => io;
