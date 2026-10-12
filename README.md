# Hexplore

A personal, installable web app that imports your Google Maps saved places from Takeout, locates each one exactly (Google Place Details by ID, OpenStreetMap as the fallback), adds areas, categories, opening hours and optional AI tags, and shows them on a fast, filterable map with stats. Everything lives in your browser; only lookup and AI calls leave the device.

The full plan (goals, data model, phases, risks) is in [docs/plan.md](docs/plan.md). This README covers what exists and how to work on it.

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

With a real export, drop `takeout-*.zip` (or the loose CSVs) on the import screen. `npm run inspect:takeout -- data/Takeout --zip data/hexplore-import.zip` reports what the app will make of an export and writes a zip with only the files it uses. Keep real exports in `data/`, which is gitignored.

**Keys** (all optional; without them the app uses OpenStreetMap only):

| Key | Where | What it adds | Cost |
| --- | --- | --- | --- |
| Google Places | `PLACES_API_KEY` in `.env`, or Settings | Exact position, type and open/closed status per place, looked up by ID | Pro tier, 5,000 free a month; the app stops at 4,500 |
| OpenRouter | Settings (key and model) | AI disambiguation, plus tags, price level and a summary per place | Cents to a few dollars for a few thousand places, once |
| TomTom | Layers panel | Live traffic tiles | Free tier |

The Google key from `.env` is built into the JS, so restrict it to the Places API and your own domains in Google Cloud.

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
| `npm run inspect:takeout -- <folder or zip>` | Reports lists, coordinates and title conflicts in an export; `--zip out.zip` writes an import-ready zip |
| `npm run accuracy -- data/Takeout` | Builds (once) and measures the resolution accuracy set; writes a classification CSV to label; `--evaluate` scores it |
| `npm run compare-models -- <model> ...` | Runs 20 places through OpenRouter models side by side (needs `OPENROUTER_API_KEY`) |

## How it fits together

```
src/
  domain/      types, taxonomy with OSM and Google type rules, opening hours, safe links
  import/      Takeout reading: zip, list CSVs, Saved Places.json, feature IDs and S2 cells, pure merge/dedupe
  db/          Dexie schema, import transaction, backup, saved views, user edits, settings
  services/    Google Places, Photon, Nominatim, Overpass, OpenRouter; rate limits, retry, IndexedDB cache
  pipeline/    resumable job queue: resolve -> match -> classify -> ai -> area
  query/       place views with derived flags, filters with facet counts, MiniSearch, kdbush
  stats/       stats computed in the data worker, country codes for the world map
  state/       Zustand stores (filters and results, map prefs, theme) and orchestration actions
  workers/     data worker (import, pipeline, stats, demo data) and search worker, via Comlink
  ui/          map, bottom sheet, list, place card, filters, stats, import, settings
  dev/         synthetic world, sample Takeout builder, fixture geocoder and Overpass, demo data
```

The map, list and filters share one result set. Filters (including open now, a drawn area and saved views) live in the URL, so any view can be bookmarked; a saved view stores the same query string.

**Place identity.** List CSVs carry a feature ID (`!1s0x...:0x...`), starred places a CID. The CID is the second half of the feature ID in decimal, so both map to `g<cid>`. Dropped pins key on coordinates, rows without a URL on a hash of title and list name. The same place can be titled differently in two lists (saved in Turkish in one, English in another); memberships keep each list's title and the place keeps its title until no list uses it.

**Feature ID points.** The first half of a feature ID is an S2 cell near where Google first placed the feature, so every row lands on the map at import without a network call. It is rough: on 50 random places from a real export, half are within 200 m and a third are 0.5 to 20 km off. It narrows searches; it is never trusted as the position.

**Pipeline.** Each stage records its own status per place in IndexedDB, retries with backoff and resumes after the tab closes.

1. **Resolve.** With a Google key, the Places API ID is built from the feature ID and Place Details returns the exact place (no name search). Otherwise OpenStreetMap: a strong name match within 15 km of the feature ID point is taken outright within 1.5 km and flagged further out (another branch is as likely), several branches are flagged, and the point alone stays flagged. Places with no point are geocoded in two passes biased by each list's clusters, with optional AI disambiguation. Accepted, flagged and review statuses follow the plan's 0.85 and 0.5 thresholds.
2. **Match.** One Overpass query per city-sized area finds the OSM feature behind each place for opening hours, website, cuisine and wheelchair tags.
3. **Classify.** Google types first, then OSM tags, onto a fixed two-level taxonomy.
4. **AI** (with an OpenRouter key and model). Batches of 25 with a strict JSON schema: tags, price level, a one-line summary, and a category only where the rules left none. Cached per input, notes excluded on request.
5. **Area.** Reverse geocoding for country, region, city and neighborhood (fallback chain neighbourhood, suburb, quarter, city district, borough).

`npm run accuracy` measures step 1's fallback against Google's positions on your own data: on the owner's sample, 1 wrong among accepted (a 294 m near miss), the rest flagged rather than guessed.

**Map.** `src/ui/mapStyle.ts` composes the whole style (base, details, then your places) as a pure function and MapLibre diffs it, so toggles are cheap even at 10,000 places. Every place shows as its own dot by default, filled when visited and ringed when wanted, with a category pictogram drawn on a canvas at street zoom. Places waiting for a check show their candidate locations as numbered markers. The layers button switches map type and details, kept per device in `localStorage` (`hexplore:map`):

| Option | Source | Key |
| --- | --- | --- |
| Light, Streets, Dark | OpenFreeMap Positron, Liberty, Dark | None |
| Satellite | Esri World Imagery under Positron's labels, borders and main roads | None (non-commercial use with attribution) |
| Transit | Rail, metro, tram and ferry lines plus stations from the same vector tiles | None |
| Terrain | Hill shading from Mapterhorn elevation tiles | None |
| 3D buildings | OpenFreeMap building heights | None |
| Visited heatmap | Density of visited places among the results | None |
| Group nearby | Clusters with counts, off by default | None |
| Globe | MapLibre globe projection when zoomed out | None |
| Traffic | TomTom live flow tiles | Your TomTom key, kept in this browser |

The unit tests validate every combination against the style spec. Label expressions fall back from a one-letter `name_en` (OpenFreeMap's tiles name Türkiye "T"). New tile hosts must also be added to the CSP in `public/_headers`.

**Stats** (menu, Stats) are computed in the data worker: totals, a world map of visited countries, countries and cities with neighborhood coverage, categories, cuisines and tags, the share of wanted places later visited, and growth per month. Every number opens the matching places on the map. Takeout has no save dates, so the first import is a "before tracking" bucket.

**Theme.** System, light or dark in Settings, applied before the first render; the light and dark map types follow the page.

**Synthetic data.** `src/dev/world.ts` generates a deterministic world (six cities, chains in several cities, same-name decoys) whose feature IDs follow the measured error mix. The sample Takeout mirrors the real export's layout: an empty `,,,,` row after each header, localized and coordinate-titled pins, untitled rows, a list that titles places in another language, an empty collection, a saved-film collection, Reviews and Labeled places files that must be ignored.

## Status against the plan

Phases 0 to 3 are done, apart from what needs hardware or keys this environment does not have:
- Real-device performance pass: the 10,000-place budgets run in CI (`src/query/perf.test.ts`), not yet on a phone.
- Classification accuracy: `data/accuracy/classification.csv` is written; it needs your labels, then `npm run accuracy -- --evaluate`.
- Model comparison spike: `npm run compare-models` is ready; it needs an OpenRouter key.
- Preview deploys: the CI job is ready; it needs the Cloudflare secrets.

Next is phase 4, the assistant.

**Bundle budget.** The plan targets 350 KB gzipped initial JS. MapLibre v6 alone is about 270 KB and React with Dexie about 120 KB, for ~396 KB today; import, stats, settings, the filter panel, the place card, the layers panel and the lasso load lazily. `budget.json` gates CI at 400 KB so it can only shrink. Levers: Preact instead of React, or pinning MapLibre 4.x.

## Deploying

Connect the repo in Cloudflare Pages with build command `npm run build` and output directory `dist`, or let CI do it: with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` set as repository secrets (and optionally `PLACES_API_KEY`), every push to main and every pull request gets a preview deploy. `public/_headers` sets a strict Content Security Policy that allows only the services the app calls.

E2E runs on Playwright's pinned Chromium in CI. Where that download is unavailable, point Playwright at an installed Chrome with a temporary config that sets `channel: 'chrome'` on the project.
