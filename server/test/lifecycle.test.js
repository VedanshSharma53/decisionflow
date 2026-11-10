import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import db from "../db.js";
import {
  changeDecisionStatus,
  approveDecision,
  rejectDecision,
} from "../services/lifecycle.js";
import { HttpError } from "../middleware/errors.js";

describe("lifecycle decision transitions", () => {
  let projectId;
  let meetingId;
  let decisionId;

  before(() => {
    const p = db.prepare("INSERT INTO projects (name, description) VALUES (?, ?)").run(
      "__test_lifecycle_project__",
      "temp"
    );
    projectId = Number(p.lastInsertRowid);
    const m = db
      .prepare(
        `INSERT INTO meetings (project_id, title, status) VALUES (?, 'Lifecycle Test Meeting', 'ENDED')`
      )
      .run(projectId);
    meetingId = Number(m.lastInsertRowid);
    const d = db
      .prepare(
        `INSERT INTO decisions
           (project_id, meeting_id, title, description, topic, keywords, certainty, status, confidence)
         VALUES (?, ?, 'Test decision', 'desc', 'test', '[]', 'AGREED', 'PROPOSED', 0.9)`
      )
      .run(projectId, meetingId);
    decisionId = Number(d.lastInsertRowid);
  });

  after(() => {
    if (decisionId) {
      db.prepare("DELETE FROM decision_history WHERE decision_id = ?").run(decisionId);
      db.prepare("DELETE FROM decisions WHERE id = ?").run(decisionId);
    }
    if (meetingId) db.prepare("DELETE FROM meetings WHERE id = ?").run(meetingId);
    if (projectId) db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  });

  it("approves PROPOSED → APPROVED and writes history", () => {
    const updated = approveDecision(decisionId, null);
    assert.equal(updated.status, "APPROVED");
    const hist = db
      .prepare(
        `SELECT * FROM decision_history WHERE decision_id = ? ORDER BY id DESC LIMIT 1`
      )
      .get(decisionId);
    assert.equal(hist.from_status, "PROPOSED");
    assert.equal(hist.to_status, "APPROVED");
  });

  it("rejects invalid APPROVED → APPROVED with 409", () => {
    assert.throws(
      () => changeDecisionStatus(decisionId, "APPROVED"),
      (err) => err instanceof HttpError && err.status === 409
    );
  });

  it("allows APPROVED → MODIFIED", () => {
    const updated = changeDecisionStatus(decisionId, "MODIFIED", {
      reason: "test modify",
    });
    assert.equal(updated.status, "MODIFIED");
  });

  it("allows MODIFIED → SUPERSEDED", () => {
    const updated = changeDecisionStatus(decisionId, "SUPERSEDED", {
      reason: "test supersede",
    });
    assert.equal(updated.status, "SUPERSEDED");
  });

  it("refuses any transition from SUPERSEDED", () => {
    assert.throws(
      () => changeDecisionStatus(decisionId, "APPROVED"),
      (err) => err instanceof HttpError && err.status === 409
    );
  });
});

describe("lifecycle reject from PROPOSED", () => {
  let projectId;
  let meetingId;
  let decisionId;

  before(() => {
    const p = db.prepare("INSERT INTO projects (name) VALUES (?)").run("__test_reject_project__");
    projectId = Number(p.lastInsertRowid);
    const m = db
      .prepare(`INSERT INTO meetings (project_id, title, status) VALUES (?, 'Reject Test', 'ENDED')`)
      .run(projectId);
    meetingId = Number(m.lastInsertRowid);
    const d = db
      .prepare(
        `INSERT INTO decisions
           (project_id, meeting_id, title, description, topic, keywords, certainty, status, confidence)
         VALUES (?, ?, 'Reject me', 'desc', 'test', '[]', 'TENTATIVE', 'PROPOSED', 0.6)`
      )
      .run(projectId, meetingId);
    decisionId = Number(d.lastInsertRowid);
  });

  after(() => {
    if (decisionId) {
      db.prepare("DELETE FROM decision_history WHERE decision_id = ?").run(decisionId);
      db.prepare("DELETE FROM decisions WHERE id = ?").run(decisionId);
    }
    if (meetingId) db.prepare("DELETE FROM meetings WHERE id = ?").run(meetingId);
    if (projectId) db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
  });

  it("rejects PROPOSED → REJECTED with a reason", () => {
    const updated = rejectDecision(decisionId, null, "not agreed");
    assert.equal(updated.status, "REJECTED");
    const hist = db
      .prepare(`SELECT * FROM decision_history WHERE decision_id = ? ORDER BY id DESC LIMIT 1`)
      .get(decisionId);
    assert.equal(hist.to_status, "REJECTED");
    assert.match(hist.reason, /not agreed/i);
  });
});
