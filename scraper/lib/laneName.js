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

const LANE_NAME_PATTERN = /^Dráha \d+$/;

// "Dráhy v 50m bazénu" (or its "(šířka)" variant) -> "50m" / "50m (šířka)".
// Categories that don't match this pattern (Bazén pro plavce, Dráhy, Malý
// bazének, ...) are returned unchanged.
function shortenPoolCategory(category) {
  const m = category.match(/^Dráhy v (\d+m) bazénu\s*(.*)$/i);
  return m ? `${m[1]}${m[2] ? ' ' + m[2] : ''}` : category;
}

// Prefixing every lane with its category only earns its keep when a venue
// actually has more than one lane category to tell apart (Lužánky: 50m vs
// 25m). A venue with a single lap pool (Aquapark's "Bazén pro plavce",
// Kravihora/Družstevní/Tesla's "Dráhy") doesn't need it repeated on every
// single lane - it's just noise ("Bazén pro plavce - Dráha 5" vs. plain
// "Dráha 5"). Mutates and returns the same resources array.
export function applyLaneDisplayNames(resources) {
  const laneCategories = new Set(resources.filter((r) => LANE_NAME_PATTERN.test(r.name)).map((r) => r.category));
  if (laneCategories.size <= 1) return resources;
  for (const r of resources) {
    if (LANE_NAME_PATTERN.test(r.name)) r.name = `${shortenPoolCategory(r.category)} - ${r.name}`;
  }
  return resources;
}
