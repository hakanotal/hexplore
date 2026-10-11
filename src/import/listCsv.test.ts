import { describe, expect, it } from 'vitest'
import { parseListCsv } from './listCsv'

describe('parseListCsv', () => {
  it('parses a plain list', () => {
    const r = parseListCsv('Title,Note,URL,Tags,Comment\nModa Sahili,,https://maps/x,,\n')
    expect(r.rows).toEqual([{ rowNumber: 2, title: 'Moda Sahili', url: 'https://maps/x', note: undefined, tags: undefined, comment: undefined }])
    expect(r.description).toBeUndefined()
  })

  it('skips the description line and the blank line after it', () => {
    const r = parseListCsv('Lisbon, long weekend\n\nTitle,Note,URL\nA,,u1\n')
    expect(r.description).toBe('Lisbon, long weekend')
    expect(r.rows.map((x) => x.title)).toEqual(['A'])
    expect(r.rows[0]!.rowNumber).toBe(4)
  })

  it('handles a byte order mark, quoted line breaks and emoji', () => {
    const csv = '\uFEFFTitle,Note,URL,Tags,Comment\n"Café ""Kedi""","Ask upstairs,\nview is better 🌇",u1,❤️,\nNext,,u2,,\n'
    const r = parseListCsv(csv)
    expect(r.rows[0]).toMatchObject({ title: 'Café "Kedi"', note: 'Ask upstairs,\nview is better 🌇', tags: '❤️' })
    expect(r.rows[1]).toMatchObject({ title: 'Next', rowNumber: 4 })
  })

  it('matches columns by name and tolerates extra or reordered columns', () => {
    const r = parseListCsv('URL,Extra,title\nu1,zzz,A\n')
    expect(r.rows[0]).toMatchObject({ title: 'A', url: 'u1' })
  })

  it('keeps rows without a URL and warns on empty rows', () => {
    const r = parseListCsv('Title,Note,URL\nNo url here,,\n,,\n,"just a note",\n')
    expect(r.rows.map((x) => x.title)).toEqual(['No url here'])
    expect(r.warnings).toHaveLength(1)
  })

  it('reports a missing header', () => {
    expect(parseListCsv('foo,bar\n1,2\n').warnings[0]).toMatch(/No header/)
  })
})
