// Opens the SQLite database file and makes sure all tables exist.
// The whole database is one file: server/data/decisionflow.db
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "data");
fs.mkdirSync(dataDir, { recursive: true });

export const DB_FILE = path.join(dataDir, "decisionflow.db");

const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL"); // faster, and safe for one server process
db.pragma("foreign_keys = ON"); // enforce REFERENCES between tables

// Create tables, indexes, search tables and triggers (safe to run every start)
db.exec(fs.readFileSync(path.join(here, "schema.sql"), "utf8"));

export default db;
