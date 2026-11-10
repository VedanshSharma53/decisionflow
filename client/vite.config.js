import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The React app runs on http://localhost:5173.
// Requests to /api and /socket.io are forwarded to the Node server on port 4000,
// so the browser only ever talks to one address (no CORS problems, mic works on localhost).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
      "/socket.io": { target: "http://localhost:4000", ws: true },
    },
  },
});
