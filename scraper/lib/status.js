// Normalized slot status values used across all venues:
//   'available'  - open for public/free swimming right now
//   'reservable' - bookable (e.g. with deposit, or lane for rent) but not free public swim
//   'reserved'   - occupied/booked by someone else
//   'closed'     - facility closed / not offered at this time
//   'unknown'    - could not be determined

export const STAREZ_COLOR_STATUS = {
  '#B2D680': 'available', // volno pro verejnost
  '#7CAC38': 'reservable', // volno k rezervaci se zalohou (Brno iD)
  '#BDEBFB': 'reservable', // volno k pronajmu
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
