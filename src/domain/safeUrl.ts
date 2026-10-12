/**
 * Links from imported or third-party data (Takeout CSVs, OSM tags, geocoders)
 * are untrusted. Only plain web links reach an href; javascript:, data: and
 * anything unparsable are dropped. OSM often omits the scheme ("example.com"),
 * which is read as https.
 */
export function safeHttpUrl(raw: string | undefined | null): string | undefined {
  const s = raw?.trim()
  if (!s) return undefined
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}
