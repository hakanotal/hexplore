# Hexplore notes for Claude

- Static PWA, no backend. React + Zustand + Tailwind v4, Dexie over IndexedDB, MapLibre v6, Comlink workers.
- Run before pushing: `npm run lint && npm run typecheck && npm test && npm run build && npm run check:bundle`. E2E: `npm run e2e` (Playwright 1.56.1 pinned to match the preinstalled Chromium).
- CI never calls live services. Use `FixtureGeocoder` or MSW for anything that would hit Photon, Nominatim, Overpass or OpenRouter.
- Import and merge are pure (`src/import/merge.ts`); keep storage out of them. Re-imports must never overwrite enrichment or `userData`.
- Dexie schema changes go in a new `version()` block, never edit version 1.
- Zustand selectors must return stable values; derive arrays with `useMemo` (an array-returning selector caused an infinite render loop once).
- Heavy work (import, pipeline, indexing) runs in workers. Keep the main thread under 50 ms per task.
- The real Takeout format is not yet confirmed against the owner's export; the parser matches columns by name and the sample in `src/dev/sampleTakeout.ts` encodes current assumptions.
