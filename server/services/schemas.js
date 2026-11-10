// Zod schemas for structured Claude outputs (SPEC §8).
// Import from zod/v4 — @anthropic-ai/sdk's zodOutputFormat requires v4-shaped schemas.
import { z } from "zod/v4";

/** Live extraction result (SPEC §8.2). Every field required; use .nullable() for optionals. */
export const ExtractionSchema = z.object({
  decisions: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      topic: z.string(),
      keywords: z.array(z.string()),
      certainty: z.enum(["AGREED", "TENTATIVE"]),
      owner: z.string().nullable(),
      confidence: z.number(),
      sourceSegmentIds: z.array(z.number()),
      sourceQuote: z.string(),
    })
  ),
  actionItems: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      owner: z.string().nullable(),
      deadline: z.string().nullable(),
      deadlineText: z.string().nullable(),
      priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
      confidence: z.number(),
      sourceSegmentIds: z.array(z.number()),
      sourceQuote: z.string(),
    })
  ),
  blockers: z.array(
    z.object({
      description: z.string(),
      owner: z.string().nullable(),
      keywords: z.array(z.string()),
      confidence: z.number(),
      sourceSegmentIds: z.array(z.number()),
      sourceQuote: z.string(),
    })
  ),
  questions: z.array(
    z.object({
      question: z.string(),
      raisedBy: z.string().nullable(),
      confidence: z.number(),
      sourceSegmentIds: z.array(z.number()),
      sourceQuote: z.string(),
    })
  ),
  updates: z.array(
    z.object({
      existingId: z.number(),
      itemType: z.enum(["decision", "action"]),
      owner: z.string().nullable(),
      deadline: z.string().nullable(),
      deadlineText: z.string().nullable(),
      description: z.string().nullable(),
    })
  ),
  resolvedQuestionIds: z.array(z.number()),
});

/** AI comparison of a new decision vs earlier candidates (SPEC §8.3). */
export const ComparisonSchema = z.object({
  results: z.array(
    z.object({
      candidateId: z.number(),
      relation: z.enum(["UNRELATED", "DUPLICATE", "MODIFIES", "SUPERSEDES", "CONFLICTS"]),
      confidence: z.number(),
      explanation: z.string(),
      changedFields: z.array(
        z.object({
          field: z.string(),
          from: z.string(),
          to: z.string(),
        })
      ),
    })
  ),
});

/** Meeting summary report — one Markdown document (SPEC §8.5). */
export const SummarySchema = z.object({
  markdown: z.string(),
});
