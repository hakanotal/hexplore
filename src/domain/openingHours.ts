// A small evaluator for the opening_hours values most OSM places use:
//
//   24/7
//   Mo-Fr 08:00-18:00; Sa 10:00-14:00; Su off
//   Mo,We 10:00-12:00,14:00-18:00
//   Tu-Su 18:00-02:00          (past midnight spills into the next day)
//   10:00-22:00                (no days: every day)
//
// Later rules replace earlier ones for the days they name, as in the OSM spec.
// Anything richer (months, week numbers, sunrise, public holidays with times,
// comments) returns undefined: "unknown" beats a wrong answer. Rules that only
// concern public holidays ("PH off") are skipped.

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/** Minutes since Monday 00:00 for each open interval, end exclusive; may pass the end of the week. */
type Week = [number, number][][]

const cache = new Map<string, Week | null>()

function parseTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null
  return h * 60 + min
}

function parseDays(sel: string): number[] | null {
  const out = new Set<number>()
  for (const part of sel.split(',')) {
    const range = /^([A-Z][a-z])(?:-([A-Z][a-z]))?$/.exec(part.trim())
    if (!range) return null
    const a = DAYS.indexOf(range[1]!)
    const b = range[2] ? DAYS.indexOf(range[2]) : a
    if (a < 0 || b < 0) return null
    for (let d = a; ; d = (d + 1) % 7) {
      out.add(d)
      if (d === b) break
    }
  }
  return [...out]
}

export function parseOpeningHours(spec: string): Week | null {
  const key = spec.trim()
  if (cache.has(key)) return cache.get(key)!
  let week: Week | null = Array.from({ length: 7 }, () => [])
  if (key === '24/7') {
    week = week.map(() => [[0, 1440]])
  } else {
    for (const raw of key.split(';')) {
      const rule = raw.trim()
      if (!rule) continue
      if (/^PH\b/.test(rule)) continue
      const m = /^(?:([A-Z][a-z](?:-[A-Z][a-z])?(?:,[A-Z][a-z](?:-[A-Z][a-z])?)*)\s+)?(.+)$/.exec(rule)
      const days = m?.[1] ? parseDays(m[1]) : DAYS.map((_, i) => i)
      const times = m?.[2]?.trim()
      if (!days || !times) {
        week = null
        break
      }
      let spans: [number, number][] | null = []
      if (times === 'off' || times === 'closed') spans = []
      else if (times === '24/7' || times === '00:00-24:00') spans = [[0, 1440]]
      else {
        for (const span of times.split(',')) {
          const [a, b] = span.trim().split('-')
          const start = a ? parseTime(a) : null
          const end = b ? parseTime(b) : null
          if (start === null || end === null) {
            spans = null
            break
          }
          spans.push([start, end <= start ? end + 1440 : end])
        }
      }
      if (!spans) {
        week = null
        break
      }
      for (const d of days) week[d] = spans
    }
  }
  cache.set(key, week)
  return week
}

/** True or false when the value is understood, undefined when it is not. Evaluated in the device's local time. */
export function isOpenAt(spec: string | undefined, date: Date): boolean | undefined {
  if (!spec) return undefined
  const week = parseOpeningHours(spec)
  if (!week) return undefined
  const day = (date.getDay() + 6) % 7
  const minute = date.getHours() * 60 + date.getMinutes()
  // Today's spans, plus yesterday's that ran past midnight.
  if (week[day]!.some(([a, b]) => minute >= a && minute < b)) return true
  const prev = week[(day + 6) % 7]!
  return prev.some(([, b]) => b > 1440 && minute < b - 1440)
}
