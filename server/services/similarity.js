/**
 * Plain keyword / word-overlap scoring (SPEC §8.3).
 * Used by conflict detection (and later by recurring blockers).
 * No AI, no special database features — just sets and Jaccard.
 */

// Common English words that don't help matching decisions
const STOP = new Set(
  `
  a an the and or but if in on at to for of from with by as is are was were be been being
  this that these those it its it's we we're we've our you your they their them he she
  will would should could can may might must do does did done have has had having
  not no nor so than then there here when where which who what how why
  about into over under again further once more also just only own same such too very
  i i'm i'll i've me my
  `.trim().split(/\s+/)
);

/** Lowercase, strip punctuation, drop stop-words → unique tokens. */
export function tokenize(text) {
  return [
    ...new Set(
      String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 1 && !STOP.has(w))
    ),
  ];
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B|. Empty sets → 0. */
export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  const union = A.size + B.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Score how similar two decisions are (SPEC §8.3):
 *   0.5 × keywordOverlap + 0.3 × titleWordOverlap + 0.2 × (same topic ? 1 : 0)
 */
export function scoreDecisions(a, b) {
  const kwA = Array.isArray(a.keywords) ? a.keywords.map((k) => String(k).toLowerCase()) : tokenize(a.keywords);
  const kwB = Array.isArray(b.keywords) ? b.keywords.map((k) => String(k).toLowerCase()) : tokenize(b.keywords);
  // Also fold topic words into the keyword sets so short keyword lists still match
  const topicA = tokenize(a.topic);
  const topicB = tokenize(b.topic);

  const keywordOverlap = jaccard([...kwA, ...topicA], [...kwB, ...topicB]);
  const titleWordOverlap = jaccard(tokenize(a.title), tokenize(b.title));

  const topicSame =
    String(a.topic || "")
      .trim()
      .toLowerCase() ===
      String(b.topic || "")
        .trim()
        .toLowerCase() && Boolean(String(a.topic || "").trim());

  return 0.5 * keywordOverlap + 0.3 * titleWordOverlap + 0.2 * (topicSame ? 1 : 0);
}

/**
 * Overlap of free text (description / keywords) — used later for recurring blockers.
 */
export function scoreText(aText, bText, aKeywords = [], bKeywords = []) {
  const A = [...tokenize(aText), ...aKeywords.map((k) => String(k).toLowerCase())];
  const B = [...tokenize(bText), ...bKeywords.map((k) => String(k).toLowerCase())];
  return jaccard(A, B);
}
