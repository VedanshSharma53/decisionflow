import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { jaccard, scoreDecisions, tokenize } from "../services/similarity.js";

describe("similarity.tokenize", () => {
  it("lowercases, drops stop-words, and de-duplicates", () => {
    const tokens = tokenize("The Launch of the Beta Launch on March");
    assert.deepEqual(tokens.sort(), ["beta", "launch", "march"].sort());
  });
});

describe("similarity.jaccard", () => {
  it("returns 1 for identical sets and 0 for disjoint sets", () => {
    assert.equal(jaccard(["a", "b"], ["a", "b"]), 1);
    assert.equal(jaccard(["a"], ["b"]), 0);
  });

  it("returns shared/union for partial overlap", () => {
    // {a,b} ∩ {b,c} = {b}; ∪ = {a,b,c} → 1/3
    assert.ok(Math.abs(jaccard(["a", "b"], ["b", "c"]) - 1 / 3) < 1e-9);
  });
});

describe("similarity.scoreDecisions", () => {
  it("scores same-topic launch decisions highly enough for conflict candidates", () => {
    const a = {
      title: "Launch the beta on 15 March",
      topic: "launch date",
      keywords: ["beta", "launch", "march", "date"],
    };
    const b = {
      title: "Move the beta launch to 1 April",
      topic: "launch date",
      keywords: ["beta", "launch", "april", "date"],
    };
    const score = scoreDecisions(a, b);
    assert.ok(score >= 0.2, `expected score ≥ 0.2, got ${score}`);
  });

  it("scores unrelated decisions below the candidate threshold", () => {
    const a = {
      title: "Use SQLite for the prototype database",
      topic: "database",
      keywords: ["sqlite", "database", "prototype"],
    };
    const b = {
      title: "Book the lab for Friday afternoon",
      topic: "logistics",
      keywords: ["lab", "friday", "booking"],
    };
    const score = scoreDecisions(a, b);
    assert.ok(score < 0.2, `expected score < 0.2, got ${score}`);
  });
});
