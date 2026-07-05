// Normalized slot status values used across all venues:
//   'available'  - open for public/free swimming right now
//   'reserved'   - occupied/booked by someone else, or only bookable ahead
//                  of time rather than usable for a walk-in swim right now
//   'closed'     - facility closed / not offered at this time
//   'unknown'    - could not be determined

export const STAREZ_COLOR_STATUS = {
  '#B2D680': 'available', // volno pro verejnost
  '#7CAC38': 'reserved', // volno k rezervaci se zalohou (Brno iD) - bookable ahead, not a walk-in swim
  '#BDEBFB': 'reserved', // volno k pronajmu - bookable ahead, not a walk-in swim
  '#F9D993': 'available', // volna sirka
  '#E19E0D': 'reserved', // rezervovana sirka
  '#ED455B': 'reserved', // prihlaste se na akci se zalohou (event)
  '#555555': 'reserved', // rezervovano
  '#CCCCCC': 'closed', // neni k dispozici
};

export function statusFromStarezColor(color) {
  if (!color) return 'unknown';
  const normalized = color.trim().toUpperCase();
  return STAREZ_COLOR_STATUS[normalized] || 'unknown';
}

export function statusFromDruzstevniLabel(label) {
  const text = (label || '').trim().toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('otevřeno pro veřejnost') || text.includes('otevreno pro verejnost')) return 'available';
  if (text.includes('zavřeno') || text.includes('zavreno')) return 'closed';
  // any other named label is treated as a reservation/lesson occupying the slot
  return 'reserved';
}
