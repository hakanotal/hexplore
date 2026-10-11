/** Normalizes names for lookups: lowercase, no diacritics, no punctuation. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  const padded = ` ${s} `
  for (let i = 0; i < padded.length - 1; i++) {
    const g = padded.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** Sørensen–Dice on character bigrams. 1 for identical, 0 for nothing shared. */
export function dice(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const A = bigrams(a)
  const B = bigrams(b)
  let overlap = 0
  let total = 0
  for (const [g, n] of A) {
    overlap += Math.min(n, B.get(g) ?? 0)
    total += n
  }
  for (const n of B.values()) total += n
  return (2 * overlap) / total
}

/**
 * Name similarity tuned for POIs: tolerant of diacritics, punctuation and one
 * name containing the other ("Kronotrop" vs "Kronotrop Kadıköy").
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = na.split(' ')
  const tb = nb.split(' ')
  const [short, long] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)]
  const contained = short.every((t) => long.has(t)) ? 0.9 : 0
  return Math.max(contained, dice(na, nb))
}

/** Great-circle distance in kilometers. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}
