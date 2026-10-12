import { categoryColor } from '../domain/taxonomy'

// Category pictograms for the map at street level, drawn on a canvas when
// MapLibre first asks for them, so nothing downloads and they work offline.
// Two inks per category: white on filled (visited) dots, the category color on
// the white want-to-go dots.

const PATHS: Record<string, string> = {
  food: 'M7 3v8M5 3v4.5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 1.6-3 3.8-3 6.5 0 1.6 1.2 2.5 3 2.5V21',
  cafe: 'M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9ZM16 11h1.5a2.5 2.5 0 0 1 0 5H16M8.5 3.5v3M12 3.5v3',
  bar: 'M5 4h14l-7 8v8M8 20h8M7.5 7h9',
  nightlife: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0ZM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
  culture: 'M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18',
  landmark: 'M12 3l3 6v11H9V9l3-6ZM6 20.5h12',
  nature: 'M12 3 6 12h3.5L6 17h12l-3.5-5H18L12 3ZM12 17v4',
  shopping: 'M6 8h12l-1 12H7L6 8ZM9 8a3 3 0 0 1 6 0',
  stay: 'M3 19V9M3 15h18v4M21 15v-2a3 3 0 0 0-3-3h-7v5M7 12.5a1.5 1.5 0 1 0 0-.01',
  sport: 'M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11',
  services: 'M12 5v14M5 12h14',
  transport: 'M7 4h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM5 11h14M8.5 21l2-4M15.5 21l-2-4',
  other: 'M12 8v8M8 12h8',
}

export const ICON_PREFIX = 'hx-cat-'
const SIZE = 16

/** Image id for a point: hx-cat-<category>-<w|c>. */
export function iconId(category: string | undefined, onColor: boolean): string {
  return `${ICON_PREFIX}${category && PATHS[category] ? category : 'other'}-${onColor ? 'w' : 'c'}`
}

export function drawCategoryIcon(id: string, ratio = 2): { width: number; height: number; data: Uint8Array } | null {
  const m = new RegExp(`^${ICON_PREFIX}([a-z]+)-([wc])$`).exec(id)
  if (!m || !PATHS[m[1]!] || typeof document === 'undefined') return null
  const px = SIZE * ratio
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(px / 24, px / 24)
  ctx.strokeStyle = m[2] === 'w' ? '#ffffff' : categoryColor(m[1])
  ctx.lineWidth = 2.4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(PATHS[m[1]!]!))
  const img = ctx.getImageData(0, 0, px, px)
  return { width: px, height: px, data: new Uint8Array(img.data.buffer) }
}
