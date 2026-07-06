// Venues label numbered swim lanes inconsistently - "dráha 1" (Aquapark/
// Ponávka), "délka 1"/"šířka 9" (Lužánky), "1. dráha" (Družstevní), "Dráha 1"
// (Kravihora/Tesla, already the target form). Unify all of them to "Dráha N"
// for consistent display. Non-lane resources (Malý bazének, Rekreační
// bazén, Vířivka, 16m bazén, ...) don't match and are returned unchanged,
// since they aren't lanes at all.
const LANE_PATTERNS = [
  /^(?:dráha|délka|šířka)\s*(\d+)$/i, // "dráha 1", "délka 1", "šířka 9"
  /^(\d+)\.\s*dráha$/i, // "1. dráha"
];

export function unifyLaneName(rawLabel) {
  const trimmed = (rawLabel || '').trim();
  for (const pattern of LANE_PATTERNS) {
    const m = trimmed.match(pattern);
    if (m) return `Dráha ${m[1]}`;
  }
  return trimmed;
}
