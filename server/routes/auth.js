// POST /api/auth/register, POST /api/auth/login, GET /api/auth/me
import { Router } from "express";
import bcrypt from "bcryptjs";
import db from "../db.js";
import { createToken, requireAuth } from "../middleware/auth.js";
import { handle, HttpError } from "../middleware/errors.js";

const router = Router();

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

router.post(
  "/register",
  handle(async (req, res) => {
    const name = (req.body.name || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    if (!name || !email || password.length < 6) {
      throw new HttpError(400, "Name, email and a password of at least 6 characters are required");
    }
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
      throw new HttpError(409, "An account with this email already exists");
    }
    const hash = await bcrypt.hash(password, 10);
    const info = db
      .prepare("INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)")
      .run(name, email, hash);
    const user = { id: Number(info.lastInsertRowid), name, email };
    res.status(201).json({ token: createToken(user), user });
  })
);

router.post(
  "/login",
  handle(async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    const ok = user && (await bcrypt.compare(req.body.password || "", user.password_hash));
    if (!ok) throw new HttpError(401, "Wrong email or password");
    res.json({ token: createToken(user), user: publicUser(user) });
  })
);

router.get("/me", requireAuth, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user) return res.status(401).json({ error: "User no longer exists" });
  res.json({ user: publicUser(user) });
});

export default router;
