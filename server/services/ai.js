// One place that talks to Claude (SPEC §8.1).
// Mock mode / missing API key → callers must NOT call askClaude; they use mock extractors instead.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import db from "../db.js";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env when used

/** True when we should skip the real API (free rule-based mode). */
export function isMockMode() {
  const mode = (process.env.AI_MODE || "mock").toLowerCase();
  if (mode === "mock") return true;
  if (!process.env.ANTHROPIC_API_KEY) return true;
  return false;
}

function logAiRun({ meetingId, kind, latencyMs, status, error }) {
  db.prepare(
    `INSERT INTO ai_runs (meeting_id, kind, latency_ms, status, error) VALUES (?, ?, ?, ?, ?)`
  ).run(meetingId ?? null, kind, latencyMs ?? null, status, error ?? null);
}

/**
 * Call Claude with a zod schema and return validated JSON.
 * effort: "low" for live extraction, "medium" for comparison / summary.
 */
export async function askClaude({
  system,
  user,
  schema,
  effort = "low",
  meetingId = null,
  kind = "EXTRACT",
}) {
  if (isMockMode()) {
    throw new Error("askClaude called while AI_MODE=mock (or no API key) — use mock helpers instead");
  }

  const started = Date.now();
  try {
    const response = await client.beta.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort, format: zodOutputFormat(schema) },
    });

    if (response.stop_reason === "refusal") {
      throw new Error("AI declined this request");
    }

    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) throw new Error("AI returned no text content");

    const parsed = schema.parse(JSON.parse(text));
    logAiRun({
      meetingId,
      kind,
      latencyMs: Date.now() - started,
      status: "OK",
    });
    return parsed;
  } catch (err) {
    logAiRun({
      meetingId,
      kind,
      latencyMs: Date.now() - started,
      status: "FAILED",
      error: err.message || String(err),
    });
    throw err;
  }
}

/** Record a mock run so the Insights / debug tables stay consistent. */
export function logMockRun({ meetingId, kind = "EXTRACT", latencyMs = 0 }) {
  logAiRun({ meetingId, kind, latencyMs, status: "OK", error: null });
}
