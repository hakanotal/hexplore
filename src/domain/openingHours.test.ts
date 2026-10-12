import { describe, expect, it } from 'vitest'
import { isOpenAt } from './openingHours'

// 2026-10-12 is a Monday.
const at = (day: number, time: string) => {
  const [h, m] = time.split(':').map(Number)
  return new Date(2026, 9, 12 + day, h, m)
}
const MO = 0
const FR = 4
const SA = 5
const SU = 6

describe('isOpenAt', () => {
  it('handles day ranges, several spans and closed days', () => {
    const spec = 'Mo-Fr 08:00-18:00; Sa 10:00-14:00; Su off'
    expect(isOpenAt(spec, at(MO, '08:00'))).toBe(true)
    expect(isOpenAt(spec, at(MO, '18:00'))).toBe(false)
    expect(isOpenAt(spec, at(SA, '13:59'))).toBe(true)
    expect(isOpenAt(spec, at(SA, '15:00'))).toBe(false)
    expect(isOpenAt(spec, at(SU, '12:00'))).toBe(false)
    expect(isOpenAt('Mo,We 10:00-12:00,14:00-18:00', at(MO, '13:00'))).toBe(false)
    expect(isOpenAt('Mo,We 10:00-12:00,14:00-18:00', at(2, '15:00'))).toBe(true)
  })

  it('spills hours past midnight into the next day, including Sunday into Monday', () => {
    expect(isOpenAt('Tu-Su 18:00-02:00', at(SA, '01:30'))).toBe(true)
    expect(isOpenAt('Tu-Su 18:00-02:00', at(MO, '01:30'))).toBe(true)
    expect(isOpenAt('Tu-Su 18:00-02:00', at(MO, '19:00'))).toBe(false)
    expect(isOpenAt('Tu-Su 18:00-02:00', at(1, '01:30'))).toBe(false) // Monday has no hours to spill over
  })

  it('lets later rules replace earlier ones and wraps day ranges', () => {
    expect(isOpenAt('Mo-Su 09:00-22:00; Fr 09:00-12:00', at(FR, '15:00'))).toBe(false)
    expect(isOpenAt('Sa-Mo 10:00-16:00', at(SU, '11:00'))).toBe(true)
    expect(isOpenAt('Sa-Mo 10:00-16:00', at(2, '11:00'))).toBe(false)
  })

  it('understands every day and 24/7, and skips holiday rules', () => {
    expect(isOpenAt('10:00-22:00', at(SU, '21:00'))).toBe(true)
    expect(isOpenAt('24/7', at(SU, '03:00'))).toBe(true)
    expect(isOpenAt('Mo-Fr 09:00-17:00; PH off', at(MO, '10:00'))).toBe(true)
  })

  it('returns unknown for values it does not understand', () => {
    expect(isOpenAt('Jan-Mar Mo-Fr 09:00-17:00', at(MO, '10:00'))).toBeUndefined()
    expect(isOpenAt('Mo-Fr sunrise-sunset', at(MO, '10:00'))).toBeUndefined()
    expect(isOpenAt('"by appointment"', at(MO, '10:00'))).toBeUndefined()
    expect(isOpenAt(undefined, at(MO, '10:00'))).toBeUndefined()
  })
})
