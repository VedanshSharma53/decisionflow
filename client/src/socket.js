// One shared Socket.IO connection for the whole app.
// The server checks the JWT in handshake.auth.token (SPEC §6).
import { io } from "socket.io-client";
import { getToken } from "./api.js";

let socket = null;

/** Connect (or reuse) the realtime socket. Returns the socket instance. */
export function getSocket() {
  if (socket && socket.connected) return socket;

  // Empty URL → same origin as the Vite app; /socket.io is proxied to the API server.
  socket = io("/", {
    auth: { token: getToken() },
    transports: ["websocket", "polling"],
    autoConnect: true,
  });

  socket.on("connect_error", (err) => {
    console.warn("[socket] connect_error:", err.message);
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
