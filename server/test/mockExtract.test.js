import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mockExtract } from "../services/extraction.js";

function seg(id, text, speaker = "Priya") {
  return { id, text, speaker, meeting_id: 1, seq: id, source: "DEMO" };
}

describe("mockExtract (SPEC §8.6)", () => {
  it("extracts a decision from 'we've decided' / 'let's move'", () => {
    const result = mockExtract(
      [
        seg(1, "We've decided to launch the beta on 15 March."),
        seg(2, "Given the testing delays, let's move the beta launch to 1 April."),
      ],
      "2026-03-01"
    );
    assert.ok(result.decisions.length >= 2);
    assert.equal(result.decisions[0].certainty, "AGREED");
    assert.ok(
      result.decisions.some((d) => /april|launch/i.test(d.title) || /april|launch/i.test(d.topic))
    );
  });

  it("extracts an action item with owner from 'Name will …'", () => {
    const result = mockExtract(
      [seg(3, "Arjun will write regression tests for the login flow by 25 March.")],
      "2026-03-01"
    );
    assert.equal(result.actionItems.length, 1);
    assert.equal(result.actionItems[0].owner, "Arjun");
    assert.ok(result.actionItems[0].deadlineText || result.actionItems[0].deadline);
  });

  it("extracts a blocker from 'waiting on/for'", () => {
    const result = mockExtract(
      [seg(4, "We're still waiting on the SMTP access from the college IT team.")],
      "2026-03-01"
    );
    assert.equal(result.blockers.length, 1);
    assert.match(result.blockers[0].description, /smtp/i);
  });

  it("extracts a question ending with ?", () => {
    const result = mockExtract(
      [seg(5, "Should we support dark mode in the beta?", "Sneha")],
      "2026-03-01"
    );
    assert.equal(result.questions.length, 1);
    assert.equal(result.questions[0].raisedBy, "Sneha");
  });

  it("ignores chit-chat that is not a decision/action/blocker/question", () => {
    const result = mockExtract(
      [
        seg(6, "By the way, the cafeteria chai was excellent today."),
        seg(7, "Also, remember to book the lab for Friday afternoon."),
      ],
      "2026-03-01"
    );
    assert.equal(result.decisions.length, 0);
    assert.equal(result.actionItems.length, 0);
    assert.equal(result.blockers.length, 0);
    assert.equal(result.questions.length, 0);
  });
});
