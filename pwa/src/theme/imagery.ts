// Curated, license-free Unsplash imagery (every URL verified to resolve). Used
// for marketing/landing presentation and as a friendly fallback when a real
// service has no photo yet — never treated as real service data. Requested at
// a capped width with auto-format so low-data devices get small, modern images.

const U = (id: string, w = 800) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=80&auto=format&fit=crop`;

/** Big, warm hero image for the landing page. */
export const heroImage = U('1600880292089-90a7e086ee0c', 1400);

/** Secondary marketing shots (provider band, trust). */
export const providerImage = U('1521737604893-d14cc237f11d', 1200);

// Keyword → image. First match on the (lower-cased) category name wins; anything
// unmatched rotates through the generic fallbacks by id so every tile gets one.
const CATEGORY_IMAGES: { keys: string[]; id: string }[] = [
  { keys: ['clean'],                              id: '1581578731548-c64695cc6952' },
  { keys: ['plumb'],                              id: '1621905251189-08b45d6a269e' },
  { keys: ['electric'],                           id: '1558618666-fcd25c85cd64' },
  { keys: ['paint'],                              id: '1497935586351-b67a49e012bf' },
  { keys: ['garden', 'landscap', 'lawn'],         id: '1595079676339-1534801ad6cf' },
  { keys: ['mov', 'reloc', 'haul', 'deliver'],    id: '1560518883-ce09059eeffa' },
  { keys: ['tutor', 'lesson', 'teach', 'educat'], id: '1544161515-4ab6ce6db874' },
  { keys: ['beauty', 'hair', 'salon', 'nail'],    id: '1554188248-986adbb73be4' },
  { keys: ['carpen', 'wood', 'furnitur'],         id: '1607472586893-edb57bdc0e39' },
  { keys: ['mechan', 'auto', 'car', 'vehicle'],   id: '1584622650111-993a426fbf0a' },
  { keys: ['applianc', 'repair', 'handy', 'fix'], id: '1556911220-bff31c812dba' },
];

const FALLBACK_IDS = [
  '1521737604893-d14cc237f11d',
  '1517048676732-d65bc937f952',
  '1523240795612-9a054b0db644',
  '1600585154340-be6161a56a0c',
];

export function categoryImage(name: string | undefined, id = 0, w = 800): string {
  const n = (name ?? '').toLowerCase();
  const hit = CATEGORY_IMAGES.find((c) => c.keys.some((k) => n.includes(k)));
  return U(hit?.id ?? FALLBACK_IDS[id % FALLBACK_IDS.length], w);
}

// Deterministic accent colour per category — mirrors the mobile home grid's
// CAT_PALETTE so a category reads the same colour on app and web.
const CAT_PALETTE = [
  '#0891B2', '#2563EB', '#7C3AED', '#D97706', '#DB2777', '#16A34A', '#4B5563',
  '#0369A1', '#15803D', '#B45309', '#1D4ED8', '#1E40AF', '#92400E', '#9D174D',
];

export function categoryColor(id: number): string {
  return CAT_PALETTE[id % CAT_PALETTE.length];
}
