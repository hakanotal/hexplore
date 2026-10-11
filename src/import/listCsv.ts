import Papa from 'papaparse'

export interface CsvRow {
  /** 1-based line of the row in the file, for error messages. */
  rowNumber: number
  title: string
  note?: string
  url?: string
  tags?: string
  comment?: string
}

export interface ParsedListCsv {
  description?: string
  rows: CsvRow[]
  warnings: string[]
}

const HEADER_ALIASES: Record<keyof Omit<CsvRow, 'rowNumber'>, string[]> = {
  title: ['title', 'name'],
  note: ['note', 'notes'],
  url: ['url', 'link'],
  tags: ['tags', 'tag'],
  comment: ['comment', 'comments'],
}

function normalizeHeader(h: string): string {
  return h.replace(/^\uFEFF/, '').trim().toLowerCase()
}

function findColumns(row: string[]): Partial<Record<keyof typeof HEADER_ALIASES, number>> | null {
  const normalized = row.map(normalizeHeader)
  const cols: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [keyof typeof HEADER_ALIASES, string[]][]) {
    const idx = normalized.findIndex((h) => aliases.includes(h))
    if (idx >= 0) cols[field] = idx
  }
  return cols.title !== undefined && cols.url !== undefined ? cols : null
}

function clean(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v ? v : undefined
}

/**
 * Parses one Takeout list CSV. Columns are matched by name so extra or
 * reordered columns are tolerated. Anything before the header row is treated as
 * the list description (Takeout writes it as an optional first line plus a blank line).
 */
export function parseListCsv(text: string): ParsedListCsv {
  const warnings: string[] = []
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: false })
  const data = result.data

  let headerIdx = -1
  let cols: ReturnType<typeof findColumns> = null
  for (let i = 0; i < Math.min(data.length, 10); i++) {
    cols = findColumns(data[i] ?? [])
    if (cols) {
      headerIdx = i
      break
    }
  }
  if (headerIdx < 0 || !cols) {
    return { rows: [], warnings: ['No header row with Title and URL columns found'] }
  }

  const description = data
    .slice(0, headerIdx)
    .map((r) => r.join(',').trim())
    .filter(Boolean)
    .join('\n')

  // Papa reports rows by record index, so recover line numbers by counting
  // newlines inside quoted fields.
  let line = 1
  for (let i = 0; i <= headerIdx; i++) line += 1 + newlineCount(data[i])

  const rows: CsvRow[] = []
  for (let i = headerIdx + 1; i < data.length; i++) {
    const r = data[i] ?? []
    const rowNumber = line
    line += 1 + newlineCount(r)
    if (r.every((cell) => !cell?.trim())) continue
    const title = clean(r[cols.title!])
    const url = clean(r[cols.url!])
    if (!title && !url) {
      warnings.push(`Row ${rowNumber}: no title or URL, skipped`)
      continue
    }
    rows.push({
      rowNumber,
      title: title ?? 'Untitled place',
      url,
      note: cols.note !== undefined ? clean(r[cols.note]) : undefined,
      tags: cols.tags !== undefined ? clean(r[cols.tags]) : undefined,
      comment: cols.comment !== undefined ? clean(r[cols.comment]) : undefined,
    })
  }

  for (const err of result.errors) {
    if (err.code !== 'UndetectableDelimiter') warnings.push(`CSV ${err.code} near record ${err.row ?? '?'}: ${err.message}`)
  }

  return { description: description || undefined, rows, warnings }
}

function newlineCount(row: string[] | undefined): number {
  if (!row) return 0
  let n = 0
  for (const cell of row) for (const ch of cell) if (ch === '\n') n++
  return n
}
