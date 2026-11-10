// Real-time updates with Socket.IO. Every meeting is a "room" named meeting:<id>.
// Step 2 adds the meeting events (meeting:join, segment:final, ...) listed in docs/SPEC.md section 6.
import { Server } from "socket.io";
import { verifyToken } from "../middleware/auth.js";

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
  });

  return io;
}

// Send an event to everyone currently viewing a meeting
export function emitToMeeting(meetingId, event, data) {
  if (io) io.to(`meeting:${meetingId}`).emit(event, data);
}

export const getIO = () => io;
