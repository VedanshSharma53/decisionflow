// Login tokens (JWT). The client sends:  Authorization: Bearer <token>
import jwt from "jsonwebtoken";

const SECRET = () => process.env.JWT_SECRET || "dev-only-secret-change-me";

export function createToken(user) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email }, SECRET(), { expiresIn: "7d" });
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET()); // throws if invalid or expired
}

// Express middleware: blocks the request unless a valid token is sent
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Please log in" });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Your session has expired, please log in again" });
  }
}
