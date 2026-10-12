# Hexplore notes for Claude

- Static PWA, no backend. React + Zustand + Tailwind v4, Dexie over IndexedDB, MapLibre v6, Comlink workers.
- Run before pushing: `npm run lint && npm run typecheck && npm test && npm run build && npm run check:bundle`. E2E: `npm run e2e` (Playwright 1.56.1 pinned to match the preinstalled Chromium).
- CI never calls live services. Use `FixtureGeocoder` or MSW for anything that would hit Photon, Nominatim, Overpass or OpenRouter.
- Import and merge are pure (`src/import/merge.ts`); keep storage out of them. Re-imports must never overwrite enrichment or `userData`.
- Dexie schema changes go in a new `version()` block, never edit version 1.
- Zustand selectors must return stable values; derive arrays with `useMemo` (an array-returning selector caused an infinite render loop once).
- Heavy work (import, pipeline, indexing) runs in workers. Keep the main thread under 50 ms per task.
- The Takeout format was confirmed against the owner's export (Oct 2026); `src/dev/sampleTakeout.ts` mirrors it. List URLs carry only the feature ID, never coordinates. The ID's first half is an S2 leaf cell near the place (`src/import/s2.ts`), so rows get an approximate point (`coordSource: 'fid'`) at import and the resolve stage refines it. List description placement is still unconfirmed.
- `data/` holds the owner's real export and is gitignored; never commit it or copy it into `public/` or fixtures. `npm run inspect:takeout -- data/Takeout [--zip out.zip]` reports what the app will make of an export.
