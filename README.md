# Hexplore

A personal, installable web app that imports your Google Maps saved places from Takeout, enriches them with coordinates, areas and categories from OpenStreetMap, and shows them on a fast, filterable map. Everything lives in your browser; only geocoder and AI calls leave the device.
The full plan (goals, data model, phases, risks) is in the Software Development Plan this repo was started from. This README covers what exists and how to work on it.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
```

No export yet? Open **Import** and choose **Import sample Takeout**. It generates a synthetic export in Google's exact layout and runs it through the real import, resolution and classification code, using an offline geocoder. **Simulate a later export** re-imports a changed version to exercise dedupe and membership removal. **Load 10,000 demo places** seeds enriched records for performance work.

To get the sample as files you can drop in by hand:

```bash
npm run fixtures     # writes fixtures/takeout-sample.zip and takeout-sample-later.zip
```

When your real export arrives, drop `takeout-*.zip` on the import screen. Nothing else changes.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck and production build (PWA included) |
| `npm test` | Unit and integration tests (Vitest, fake IndexedDB) |
| `npm run e2e` | Playwright on a Pixel 7 viewport, offline map style |
| `npm run lint` / `npm run typecheck` | ESLint, `tsc -b` |
| `npm run check:bundle` | Fails if first-paint JS exceeds `budget.json` |
| `npm run fixtures` | Writes sample Takeout zips to `fixtures/` |

## How it fits together

```
src/
  domain/      types (Place, List, Membership, UserData, Job...) and the taxonomy with OSM tag rules
  import/      Takeout reading: zip, list CSVs, Saved Places.json, Google URL keys, pure merge/dedupe
  db/          Dexie schema, import transaction, backup, user edits, settings
  services/    Photon and Nominatim clients, rate limiting, retry, IndexedDB response cache
  pipeline/    resumable job queue: resolve -> area -> classify, confidence scoring, list clusters
  query/       place views with derived flags, filters with facet counts, MiniSearch, kdbush
  state/       Zustand store (filters, results, selection) and orchestration actions
  workers/     data worker (import, pipeline, demo data) and search worker, via Comlink
  ui/          map, bottom sheet, list, place card, filters, import, settings
  dev/         synthetic world, sample Takeout builder, fixture geocoder, demo data
```

The map, list and filters share one result set. Simple filters are applied in memory and the GeoJSON source is rebuilt from the filtered set. Filters are encoded in the URL, so any view can be bookmarked.

**Place identity.** List CSVs carry a feature ID (`!1s0x...:0x...`), starred places carry a CID. The CID is the second half of the feature ID in decimal, so both map to the key `g<cid>`. Dropped pins key on coordinates, and rows without a URL fall back to a hash of title and list name.

**Resolution.** Places without coordinates are geocoded in two passes. Pass one accepts only unambiguous matches. Then each list's geographic clusters are computed, and pass two scores the rest by name similarity plus proximity to the list's clusters, weighted by how concentrated the list is. A note that names a city counts as strong evidence. Above 0.85 is accepted, 0.5 to 0.85 is accepted and flagged, below goes to review. On 1,000 synthetic places this gives zero wrong auto-accepts; flagged places show their candidates on the place card, with "use this" and "place pin myself".

**Synthetic data.** `src/dev/world.ts` generates a deterministic world (six cities, realistic categories, chains that exist in several cities, plus same-name decoys in the fixture geocoder). The sample Takeout includes the awkward parts of real exports: a byte order mark, a description line, quoted multi-line notes, emoji, dropped pins, a row without a URL, starred places with `[0, 0]` positions, an empty list and an unrelated file.

## Status against the plan

Done: phase 0 setup (CI, tests, PWA, Cloudflare Pages headers), phase 1 import and resolution (parser, Dexie schema, merge and re-import, list roles, resolution worker with list-context biasing and confidence scoring, review on the place card, backup), and most of phase 2 (map with clustering and visited styling, filters with live counts in the URL, text search, near me, search this area, virtualized bottom sheet, place card and actions).

Not yet: LLM disambiguation (the `Disambiguator` hook exists), Overpass matching, LLM classification, embeddings, saved views, lasso, category icons on the map, stats, the assistant, trips. Stage names and job queue already account for them.

**Bundle budget.** The plan targets 350 KB gzipped initial JS. MapLibre v6 alone is about 270 KB, React and Dexie about 120 KB, for ~392 KB today. `budget.json` gates CI at 400 KB so it can only shrink. Levers: Preact instead of React (open decision in the plan), or pinning MapLibre 4.x (~210 KB including its worker).

## Deploying

Connect the repo in Cloudflare Pages with build command `npm run build` and output directory `dist`. `public/_headers` sets a strict Content Security Policy that allows only the services the app calls.
