import { describe, expect, it } from 'vitest'
import { safeHttpUrl } from './safeUrl'

describe('safeHttpUrl', () => {
  it('keeps web links and adds a missing scheme', () => {
    expect(safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHttpUrl('http://maps.google.com/?cid=1')).toBe('http://maps.google.com/?cid=1')
    expect(safeHttpUrl(' example.com ')).toBe('https://example.com/')
  })

  it('drops script, data and other schemes, and junk', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeUndefined()
    expect(safeHttpUrl('JavaScript:alert(1)')).toBeUndefined()
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined()
    expect(safeHttpUrl('vbscript:x')).toBeUndefined()
    expect(safeHttpUrl('https://')).toBeUndefined()
    expect(safeHttpUrl('')).toBeUndefined()
    expect(safeHttpUrl(undefined)).toBeUndefined()
  })
})
