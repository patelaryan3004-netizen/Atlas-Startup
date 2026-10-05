// One confidence number for a candidate: how ready it is for a person to approve.
// It is for ordering the review queue and nothing else. It never publishes anything.
//
//   0.40 x how Australian it looks
//   0.35 x how much like a startup it looks
//   0.25 x how good the evidence is (high 1, medium 0.6, low 0.3, by field), helped
//          a little when independent sources found it separately
//
// capped at 0.5 while a possible duplicate is unresolved (identity first), and at
// 0.6 with no website (nothing to check the rest against). The breakdown is stored
// so the number can always be explained.
const round2 = (n) => Math.round(n * 100) / 100;
const WEIGHT = { high: 1, medium: 0.6, low: 0.3 };

export function scoreCandidate(candidate) {
  const australian = Math.max(0, candidate.australian?.score ?? 0);
  const startup = Math.max(0, candidate.startup?.score ?? 0);

  const best = new Map();
  for (const e of candidate.evidence ?? []) best.set(e.field, Math.max(best.get(e.field) ?? 0, WEIGHT[e.confidence] ?? 0));
  const quality = best.size ? [...best.values()].reduce((a, b) => a + b, 0) / best.size : 0.1;
  const independent = new Set((candidate.discoveries ?? []).map((d) => d.source_id)).size;
  const corroboration = Math.min(0.2, 0.1 * Math.max(0, independent - 1));
  const evidence = Math.min(1, quality + corroboration);

  let score = 0.4 * australian + 0.35 * startup + 0.25 * evidence;
  const caps = [];
  if (candidate.resolution && candidate.resolution !== 'NEW_COMPANY') { score = Math.min(score, 0.5); caps.push('possible duplicate unresolved'); }
  if (!candidate.website) { score = Math.min(score, 0.6); caps.push('no website to check against'); }
  score = round2(score);
  return {
    score,
    label: score >= 0.75 ? 'high' : score >= 0.5 ? 'medium' : 'low',
    breakdown: { australian: round2(australian), startup: round2(startup), evidence: round2(evidence), corroboration: round2(corroboration), caps },
  };
}
