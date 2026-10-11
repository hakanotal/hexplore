import type { StyleSpecification } from 'maplibre-gl'

export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

/** Offline style for tests and e2e runs: no tiles, no glyphs, no network. */
export const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8edf2' } }],
}

export function resolveMapStyle(): string | StyleSpecification {
  const configured = import.meta.env.VITE_MAP_STYLE as string | undefined
  if (configured === 'blank') return BLANK_STYLE
  return configured || OPENFREEMAP_STYLE
}
