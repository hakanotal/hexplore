# Places Explorer: Software Development Plan

Oct 10, 2026 · @Hakan

## Overview

Places Explorer is a personal, installable web app that imports your Google Maps saved places, enriches them with categories and areas, and shows them on an OpenStreetMap map with fast filters, stats and an AI assistant.

Google Maps stays the input. You keep saving places there, including your manually maintained visited list, export through Google Takeout, and re-import whenever you want the app to catch up.

**Goals**

- Find any saved place in under 3 seconds by name, type, area, list or visited status.
- Keep the map smooth on a mid-range phone with 10,000 places.
- Show where you have been: countries, cities, neighborhoods, categories and growth over time.
- Provide an assistant that searches your places, plans trips and recommends new places based on your history.
- Keep data on your device by default. Only AI and lookup calls leave it.

**Non-goals for v1**

- Replacing Google Maps for navigation, reviews or discovery.
- Automatic sync from Google. There is no public API for saved lists, so import stays manual.
- Multiple users, accounts or social features.

**Assumptions**

- One user with a few hundred to a few thousand places across several lists.
- At least one list means "visited" and one or more mean "want to go".
- OpenRouter is the only LLM provider, using your own API key.

## Data sources and import

The app reads the Google Takeout zip directly in the browser, so files are never uploaded anywhere. You select "Saved" and "Maps (your places)" in Takeout, download the zip and drop it into the app.

| Source | File | Fields | Coordinates |
| --- | --- | --- | --- |
| Your lists | One CSV per list in `Saved/` | Optional description line, title, note, URL, tags, comment ([schema](https://developers.google.com/data-portability/schema-reference/save)) | No |
| Starred places | `Saved Places.json` (GeoJSON) | Name, address, Maps URL, saved date | Yes |

**Parsing**

- Unzip with fflate and parse CSVs with Papa Parse, which handles quoted line breaks and byte order marks. Skip the optional description line and the blank line after it.
- The list name comes from the CSV file name.
- Extract Google's feature ID from the URL (the `!1s0x…:0x…` segment) and use it as the stable key. Dropped pins carry coordinates in the URL; parse those directly.
- Rows with no usable ID fall back to a hash of title plus list name.
- Takeout only exports lists you created. Lists you joined from other people will not appear, which the import screen should state.

**List roles**

On first import you assign each list a role: visited, want to go, favorite or other. Roles drive visited status, the "saved but never been" view and recommendations. New lists found on later imports prompt for a role.

**Re-import and dedupe**

- One place appears once, even if it sits in several lists. List membership is a separate relation.
- New rows become new places with `firstSeenAt` set to the import date. Over months this builds an approximate timeline that the export itself lacks.
- Changed notes or tags update the place. Rows missing from a list remove that membership but keep the place and all your enrichment.
- Unchanged files are skipped by content hash.
- An import summary shows counts for new, updated, removed and needs review.

**Later option: automatic import.** Google's Data Portability API can export saved collections over OAuth, which would remove the Takeout step. It is only available in some countries, gives 7 days of access while an app is in testing status, and needs Google verification to publish ([time-based access](https://developers.google.com/data-portability/user-guide/time-based)). Worth a spike in phase 7, not a dependency.

## Architecture and tech stack

The app is a static PWA with no backend of its own: a React UI over an in-memory query layer, Web Workers for heavy jobs, and IndexedDB as the only copy of your data.

&#91;embedded content: System architecture · device and external services\]

The chat and the map share one query layer, so anything the assistant finds shows on the map with the same markers and filters.

| Area | Choice | Why |
| --- | --- | --- |
| Language and build | TypeScript, Vite | Fast builds, small output, type safety across workers |
| UI | React, Zustand for state, Tailwind CSS | Large ecosystem; one small global store for filters and selection |
| Map | MapLibre GL JS, OpenFreeMap tiles | GPU rendering, free tiles, no API key |
| Storage | Dexie over IndexedDB | Typed tables, indexes, fast bulk writes |
| Search | MiniSearch, kdbush with geokdbush | Fuzzy text and nearest-place lookups in memory |
| Embeddings | transformers.js in the browser, OpenRouter as option | Private by default, no per-call cost |
| Workers | Comlink | Simple typed calls between main thread and workers |
| Files | fflate, Papa Parse | Unzip and parse CSV in the browser |
| AI | OpenRouter chat completions with tool calling and JSON schema output | One key, any model, switchable per task |
| Geodata | Photon, Nominatim, Overpass | OSM-based, results may be stored |
| Routing | OpenRouteService | Travel-time matrix and directions on a free tier |
| Offline | vite-plugin-pwa (Workbox) | Install to home screen, cache app and tiles |
| Charts | uPlot or Chart.js | Small bundles |
| Hosting | Cloudflare Pages, optional Worker proxy | Free static hosting; proxy only if the app is shared |
| Testing | Vitest, MSW, Playwright, Lighthouse CI | See Testing |

## Data model

Six core stores in IndexedDB (via Dexie) hold the place data; trips and chats stores are added with the assistant. Places are the core record; everything Google gave you stays separate from what the app derived and what you added, so re-imports never overwrite your edits.

| Store | Key fields | Notes |
| --- | --- | --- |
| `places` | `id`, `googleFid`, `title`, `lat`, `lng`, `resolveStatus`, `resolveConfidence`, `resolveSource`, `osmId`, `address`, `country`, `region`, `city`, `neighborhood`, `category`, `subcategory`, `aiTags[]`, `priceLevel`, `openingHours`, `firstSeenAt`, `updatedAt` | Indexed on `category`, `country`, `city`, `neighborhood`, `firstSeenAt` |
| `memberships` | `placeId`, `listId`, `note`, `googleTags`, `comment`, `addedAt`, `removedAt` | Notes live per list because Google stores them that way |
| `lists` | `id`, `name`, `role` (visited, want to go, favorite, other), `color`, `description` | Role set by you on first import |
| `userData` | `placeId`, `userTags[]`, `userNote`, `visits[]` (date, rating, note), `pinned` | Never touched by import |
| `embeddings` | `placeId`, `model`, `vector` (Float32Array), `textHash` | Rebuilt only when the source text changes |
| `imports` | `id`, `date`, `fileHashes`, `counts` | Audit log and skip-unchanged check |

**Derived fields**

- `visited` = member of any list with role visited, or at least one entry in `visits[]`.
- `wantToGo` = member of a want-to-go list and not visited.
- `searchText` = title, category, tags, notes and area names joined, used for fuzzy search and embeddings.

**Taxonomy**

A fixed two-level taxonomy stored as config, around 15 top categories (food, cafe, bar, culture, nature, shopping, nightlife, stay, sport, services, transport, landmark, other) with subcategories under each. Fixed categories keep filters and stats stable; free-form `aiTags` carry the long tail (rooftop, vegan, good for work, kid friendly).

**Backup format**

One versioned JSON file with all stores except embeddings, which are cheap to rebuild. Export and import of this file is the backup and the way to move between devices until sync exists.

## Location resolution and AI classification

Every place passes through five stages once, at import, and the results are cached. The pipeline runs in a Web Worker as a resumable job queue stored in IndexedDB, so closing the tab mid-import loses nothing.

**Why OpenStreetMap is the source of truth, not Google Places.** Google's service terms forbid using Places API content with a non-Google map and allow caching coordinates for only 30 days ([terms](https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240522)). Since the app draws on an OSM map and stores coordinates permanently, resolution uses OSM-based services.

1. **Resolve coordinates.** Starred places and dropped pins already have them. For the rest, search the title with an OSM geocoder: Photon for fuzzy POI names, Nominatim as fallback (1 request per second policy), or a hosted OSM geocoder with a free tier and storage-friendly terms (Geoapify, LocationIQ, OpenCage) if volume needs it.
   - **List context as a hint.** Places in one list cluster geographically. Resolve the confident matches first, compute each list's clusters, then bias ambiguous searches toward them. Notes often name a city too.
   - **LLM disambiguation.** When several candidates come back, send title, note, list name, list cluster and up to 5 candidates (name, address, OSM tags, distance) to a small model with structured output. It returns the chosen candidate and a confidence.
   - **Confidence score** from name similarity, distance to the list cluster and LLM confidence. Above 0.85 is accepted, 0.5 to 0.85 is accepted and flagged, below 0.5 goes to the review queue.
   - **Review screen** shows candidates on a map. Tap one, search again, or long-press to drop a pin.
2. **Match to an OSM feature.** One Overpass query per area cluster fetches named POIs within about 50 m of each point. The best name match gives `osmId` plus tags such as `amenity`, `cuisine`, `opening_hours`, `website` and `wheelchair`.
3. **Classify.** Rules first: most OSM tags map straight to the taxonomy (`amenity=cafe` becomes cafe). The LLM then handles unmatched places and adds tags for all of them.
   - Input per place: title, note, list names, Google tags and comments, OSM tags, address.
   - Output via JSON schema: `category`, `subcategory`, up to 8 `aiTags`, `priceLevel` (1 to 4 or null), `confidence`, a one-line summary.
   - 25 to 50 places per request, temperature 0, a small fast model. Results cached by a hash of the inputs plus taxonomy version.
   - Rough cost: 2,000 places at about 300 input and 80 output tokens each is under 1M tokens in total, which costs cents to a few dollars depending on the model.
4. **Assign area.** Reverse geocode each point (Nominatim reverse with address details) to get country, region, city and neighborhood. Neighborhood naming varies by country, so map it with a fallback chain: neighbourhood, suburb, quarter, city district.
5. **Embed.** Build `searchText` and embed it, either through OpenRouter's embeddings endpoint or in the browser with transformers.js and a small model. At 384 dimensions, 2,000 places take about 3 MB.

Each stage records its own status per place, so a failed or rate-limited call retries with backoff without redoing earlier stages. Changing the taxonomy or the classification prompt re-runs stage 3 only.

## Map, filters and core UI

The home screen is a full-screen map with a search bar on top and a bottom sheet for results, built for one-handed use on a phone. Search, filters, the list and the map always show the same result set.

**Map**

- MapLibre GL JS with OpenFreeMap tiles (free, no key) to start, and a self-hosted Protomaps PMTiles file on Cloudflare R2 as the fallback. Use a quiet custom style with few POI labels so your own points stand out.
- One GeoJSON source with clustering on. Points are colored by category and show a category icon at high zoom. Visited places are filled; want-to-go places are outlined.
- Simple toggles (category, visited) use MapLibre filter expressions, so data is not re-uploaded. Text, semantic and drawn-area filters rebuild the source from the filtered set, which stays under 50 ms at 10,000 places.
- Tapping a cluster zooms in. Tapping a point opens its card in the bottom sheet.

**Search and filters**

- Fuzzy text search with MiniSearch over title, notes, tags and area names. A toggle switches to semantic search using embeddings, for queries like "quiet place to read".
- Filter groups: category, list, visited status, area (country, city, neighborhood picker), tags, date first seen, has notes, and open now (OSM `opening_hours` parsed with opening\_hours.js).
- Options within a group combine with OR; groups combine with AND. Each option shows a live count.
- "Search this area" limits results to the current viewport. A lasso tool draws a custom area.
- Saved views store a filter combination under a name, for example "Lisbon food, not visited". Filters are also encoded in the URL so any view can be bookmarked.

**Bottom sheet**

- Three snap points: peek (result count and active filter chips), half (list sorted by distance or relevance) and full. The list is virtualized.
- A chat button opens the assistant in the same sheet, so its results land on the same map.

**Near me**

One tap centers on your location, sorts results by distance and draws a radius ring (500 m, 1 km or 5 km). Want-to-go places inside the ring are highlighted.

**Place card**

- Name, category, area, lists, notes, your tags and visits, and OSM details such as hours and website.
- Actions: open in Google Maps (the original URL), directions (Google or Apple Maps deep link), mark visited, add tags, fix location.
- Marking visited records a local visit. Google's list is not changed, so the card reminds you to add it there if you want both to match.

**Settings**

OpenRouter key, model choice per task, geocoder choice, taxonomy editor, backup export and import, storage usage and theme.

## Stats

The stats screen answers two questions, where you have been and what you like, and every number or chart element is tappable to apply that filter on the map.

| Panel | Shows | Source |
| --- | --- | --- |
| Totals | Saved, visited, want to go, countries, cities, neighborhoods | Lists and roles |
| Coverage | World map with visited countries filled, cities ranked by visited count, neighborhood coverage per city | Area fields |
| Taste | Category and tag breakdown, visited versus saved; top cuisines | Classification |
| Backlog | Want-to-go count by city, oldest unvisited saves, share of want-to-go places you later visited, by city and category | Lists plus `firstSeenAt` |
| Growth | Places added per month, visits per month | `firstSeenAt`, local `visits[]` |
| Heatmap | Density of visited places, as a map layer | Coordinates |

**Limitation on dates.** Takeout lists carry no save dates, so the first import puts everything into one "before tracking" bucket. Growth charts become accurate from the first import onward, and local visits you log carry exact dates.

**Implementation.** Stats are computed in a Web Worker straight from IndexedDB and cached until the next import or edit. Charts use a small library such as uPlot or Chart.js. Country shapes come from simplified Natural Earth boundaries, about 100 KB as TopoJSON.

## AI assistant

The assistant is a tool-calling agent that runs in the browser. The model decides which tools to call, the tools run locally against your data, and results show on the map as well as in the chat.

**Turn loop**

1. Your message goes to OpenRouter's chat completions endpoint with the tool definitions and a context block: counts per list, top cities, the taxonomy, current viewport and filters, your location if allowed, and the local date and time.
2. The model returns tool calls. The app runs them locally (IndexedDB, search index, embeddings) or against external services (geocoder, Overpass, routing).
3. Results go back in compact form: id, name, category, area, distance, visited and a short note, at most 30 rows. This keeps token use low.
4. The loop repeats until the model answers, capped at 6 tool rounds per turn.
5. The answer streams into the chat. Place names render as chips that open the place card, and map actions apply as they arrive.

**Tools**

| Tool | Purpose | Runs on |
| --- | --- | --- |
| `search_places` | Text or semantic query plus filters: categories, tags, lists, visited, area names, near point and radius, bounding box, open at a time, sort, limit | Local |
| `get_place` | Full record with notes, visits and OSM details | Local |
| `geocode` | Turns "Kadıköy" or "near the Louvre" into a point or bounding box | Geocoder |
| `get_profile` | Aggregates and taste profile: top categories, tags, price levels, overall or for one area | Local |
| `find_new_places` | OSM POIs in an area matching categories or tags, excluding places you already saved | Overpass |
| `plan_trip` | Orders chosen places into a schedule with travel times and opening hours | Local plus routing API |
| `show_on_map` | Highlights places, fits bounds, draws a route | UI |
| `set_filters` | Applies filters to the main view so you can keep browsing | UI |
| `update_place` | Adds tags or a note, marks visited; always asks you to confirm | Local |
| `web_search` (optional) | Current info such as closures, events or reviews, through OpenRouter's server-side web search | OpenRouter |

**Example requests**

- "Cafes I haven't been to near Kadıköy": `geocode`, then `search_places` with category cafe, visited false and a 1.5 km radius, then `show_on_map`.
- "Plan Saturday in Lisbon with two museums, lunch and a viewpoint from my list": three `search_places` calls, then `plan_trip`, then `show_on_map` with the route.
- "Somewhere for dinner near my hotel, similar to places I loved in Tokyo": `get_profile` for Tokyo, `search_places` for want-to-go places nearby, `find_new_places` for new options, then a ranked answer.

**System prompt rules**

- Facts about your places come only from tool results. The model never presents a place as saved unless a tool returned it.
- New places from OSM or the web are labeled as not in your lists.
- Writes need your confirmation in the UI.
- Short answers suited to a phone screen, in the language you write in.

**Models.** Model IDs live in settings, one per task: a fast, cheap model with reliable tool calling for chat, and an optional stronger one for trip planning. OpenRouter's model fallback list covers provider outages. Static parts of the prompt (rules, tool schemas, taxonomy) go first so prompt caching applies where the model supports it.

**Memory.** Chat history is stored per conversation in IndexedDB. Turns beyond a token budget are summarized into one message.

**Evaluation.** A fixed set of about 30 test requests with the expected tool calls and arguments. Run it whenever the model, prompt or tool schemas change.

## Trip planning and recommendations

The LLM chooses what to include; deterministic code does the scheduling. Models are poor at travel-time arithmetic and opening hours, while a small solver handles 15 stops in milliseconds.

**Trip planning**

1. **Inputs**: area, date, start and end time, travel mode, must-include places, the mix you want (two museums, lunch, a viewpoint) and pace.
2. **Candidates**: the assistant calls `search_places`, preferring want-to-go places, then favorites, then new places if you asked for them.
3. **Travel times**: a time matrix for the candidates from OpenRouteService's matrix API, falling back to straight-line distance with a speed factor per mode.
4. **Constraints**: default visit length per category (museum 90 min, restaurant 75, cafe 45, viewpoint 20), opening hours for the trip date, and meal windows (lunch 12:00 to 14:00, dinner 19:00 to 21:00).
5. **Solve**: greedy insertion followed by 2-opt improvement, treating it as a route with time windows. Places that don't fit are dropped with a reason, such as "closed on Mondays".
6. **Output**: ordered stops with arrival times and travel legs, the route drawn on the map, and a short narrative written by the LLM.
7. **Multi-day trips**: cluster candidates geographically into days first, then schedule each day.

Trips are saved in a `trips` store (stops, times, route geometry) and can be exported as a Google Maps directions link with waypoints or as a GPX file.

**Recommendations**

Candidates come from three pools, ranked against a taste profile built from your visited and favorite places.

| Pool | What | Trust |
| --- | --- | --- |
| Want to go | Places you saved but haven't visited | Highest: you already chose them |
| Revisit | Favorites and visited places nearby you may have forgotten | High |
| New | OSM POIs in the area, excluding anything already saved | Lower: needs a quality check |

- **Taste profile**: category and tag frequencies, typical price level, and a profile vector, the average embedding of your favorites and visited places.
- **Score**: similarity to the request (or the profile when the request is vague), category weight, and a distance penalty. Each result carries a reason, for example "similar to two cafes you saved in Berlin".
- **Quality gap**: OSM has no ratings. For the top 5 new candidates, the assistant can optionally run `web_search` to check reviews and confirm the place is still open. This costs more per request, so it is a setting.
- **Feedback**: thumbs up or down on each recommendation adjusts weights. "Save" adds it locally and offers a deep link to save it in Google Maps too.
- **Nearby nudge**: while the app is open, a banner appears when want-to-go places are within 500 m. A PWA can't track location in the background, so this only works with the app on screen.

## Privacy, security and cost

Your data lives in the browser, and only the calls below leave the device. Running costs stay under about $5 a month at personal use.

**What leaves the device**

| Call | Data sent | When |
| --- | --- | --- |
| Geocoder, Overpass, reverse geocode | Place names, coordinates | Import and new places |
| OpenRouter classification | Title, note, tags, OSM tags, address | Import |
| OpenRouter embeddings (unless local) | Search text per place | Import |
| OpenRouter chat | Your message, context summary, tool results, location if allowed | Each chat turn |
| Routing API | Coordinates of trip stops | Trip planning |

**Controls**

- In OpenRouter's privacy settings, block providers that may train on inputs and prefer zero data retention endpoints.
- An app setting excludes notes from all AI calls. Local embeddings keep search text on the device.
- Your location is sent only when you allow it for that conversation.

**API key handling**

- Personal use: the OpenRouter key is stored in IndexedDB and calls go straight from the browser. Protect it with a strict Content Security Policy, no third-party scripts, and a monthly credit limit on the key.
- If the app is ever shared: move the key into a Cloudflare Worker proxy behind Cloudflare Access, with rate limits.

**Storage durability**

The app calls `navigator.storage.persist()`. Safari can clear storage for sites unused for 7 days, but installed home screen apps are exempt, so install the PWA on iOS. A monthly reminder prompts a one-tap backup export until sync exists.

**Running costs (estimates)**

| Item | Cost |
| --- | --- |
| Hosting on Cloudflare Pages | Free |
| Map tiles from OpenFreeMap | Free; self-hosted PMTiles a few dollars a month |
| Geocoding and Overpass | Free within fair-use limits |
| Classification, one time | Cents to a few dollars per 2,000 places |
| Chat | Under 1 cent per turn on a small model, about 5 cents on a large one |
| Routing (OpenRouteService) | Free tier |

## Performance targets

Targets are measured on a mid-range Android phone over 4G with 10,000 places loaded, and checked in CI where possible.

| Metric | Target | How |
| --- | --- | --- |
| Cold start to usable map | Under 3 s | Map and list in the main bundle; stats, chat and import lazy loaded |
| Warm start | Under 1 s | Service worker caches the app shell; places load from IndexedDB in one read |
| Pan and zoom | 60 fps | GPU symbol layers with clustering; no DOM markers |
| Filter change | Under 100 ms | In-memory arrays and indexes; filter expressions for simple toggles |
| Text search per keystroke | Under 30 ms | MiniSearch index built in a worker and cached |
| Semantic search | Under 150 ms | Brute-force cosine similarity over a Float32Array in a worker |
| Near me sort | Under 50 ms | kdbush spatial index with geokdbush |
| Initial JavaScript | Under 350 KB gzipped | Bundle budget enforced in CI; MapLibre is most of it |

**Rules**

- No main-thread task over 50 ms. Import, stats, indexing and embeddings run in workers.
- Lists are virtualized and never render more rows than fit on screen plus a buffer.
- Test on real devices, an Android phone through Chrome remote debugging and an iPhone in Safari, before each phase is called done.

## Roadmap

Seven phases take about 8 to 10 weeks of full-time work for one developer using AI coding tools, or roughly double part time. These are estimates. Phases 0 to 3 produce a complete app without chat, so the AI work never blocks daily use.

&#91;embedded content: Roadmap · 7 phases with gates\]

Each gate must pass before the next phase starts; a failed gate means fixing that phase, not adding scope.

**Phase 0: Spike and setup**

- [x] Repo with Vite, TypeScript, React, ESLint, Vitest and Playwright; CI on GitHub Actions; preview deploys on Cloudflare Pages (job ready, needs the Cloudflare secrets)
- [x] Export your Takeout and parse it in a throwaway script; note any column variations (`npm run inspect:takeout`)
- [x] Geocode 50 sample places with Photon and Nominatim and measure the auto-resolve rate (Photon, against Google positions: `npm run accuracy`)
- [ ] Run 20 classification samples through 2 or 3 OpenRouter models (`npm run compare-models` is ready; needs an OpenRouter key)

**Phase 1: Import and resolution**

- [x] Zip and CSV parser with fixtures; feature ID extraction
- [x] Dexie schema and migrations
- [x] Merge, dedupe and re-import logic with an import summary
- [x] List role assignment screen
- [x] Resolution worker: geocoding, list-context biasing, LLM disambiguation, confidence scoring (plus Google Place Details by ID)
- [x] Review queue with candidate map and manual pin
- [x] Backup export and import

**Phase 2: Map and browse**

- [x] Map with a quiet OpenFreeMap style, clustering, category icons and visited styling (clustering is opt-in)
- [x] Filter store, filter panel with live counts, filters in the URL
- [x] MiniSearch text search; near me with kdbush
- [x] Bottom sheet with virtualized list, place card and actions
- [x] Saved views
- [x] PWA manifest, service worker, persistent storage request
- [ ] Performance pass on real devices (budgets at 10,000 places pass in CI; phone runs still to do)

**Phase 3: Enrichment and stats**

- [x] Overpass matching per area cluster
- [x] Taxonomy config, rule mapping, batched LLM classification
- [x] Reverse geocoding and area normalization
- [x] Stats worker, stats screen, heatmap layer
- [x] Resolution and classification accuracy sets (classification set awaits your labels: `data/accuracy/classification.csv`)

**Phase 4: AI assistant**

- [ ] OpenRouter client with streaming, tool calls, retries and fallback models
- [ ] Tool schemas and implementations
- [ ] Chat sheet with place chips and map actions
- [ ] Embeddings and semantic search
- [ ] Assistant eval set and runner; per-turn cost display

**Phase 5: Trips and recommendations**

- [ ] OpenRouteService matrix and directions client with straight-line fallback
- [ ] Schedule solver with time windows and opening hours
- [ ] Trip view, saving, GPX and Google Maps export
- [ ] Taste profile, new-place pool, ranking and feedback
- [ ] Optional web search quality check

**Phase 6: Polish and extras**

- [ ] Sync, once the open decision is made
- [ ] Data Portability API spike
- [ ] Visit logging, nearby nudge, year in review

## Testing

CI never calls live services. Accuracy of resolution, classification and the assistant is measured against small hand-labelled sets that you build once from your own data.

| Layer | Tool | Covers |
| --- | --- | --- |
| Unit | Vitest | CSV parsing (description line, quoted line breaks, emoji tags, missing URLs, dropped pins), feature ID extraction, merge and dedupe, confidence scoring, taxonomy rules, opening hours, trip solver |
| Integration | Vitest with MSW | Full pipeline against recorded geocoder, Overpass and OpenRouter responses |
| End to end | Playwright, phone viewport | Import zip, review queue, filters, near me with mocked location, chat with a mocked model |
| Performance | Lighthouse CI, synthetic 10,000-place dataset | Bundle size and load-time budgets |

**Accuracy sets**

- **Resolution**: 100 of your places with known correct coordinates. Target under 2% wrong among auto-accepted places and under 10% sent to review.
- **Classification**: the same 100 places with hand-assigned categories. Target 90% or better on the top-level category.
- **Assistant**: about 30 requests with expected tool calls. Track pass rate and average cost per turn, and rerun on any model, prompt or schema change.

## Risks and mitigations

The two risks most likely to hurt are wrong coordinates for ambiguous names and scope creep; both are addressed in the plan's structure.

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Ambiguous names resolve to the wrong place | Wrong map points and stats | List-context biasing, LLM disambiguation, review queue, "fix location" on every card |
| Scope creep | Nothing usable ships | Phase gates; phases 0 to 3 are a complete, useful app without AI chat |
| Takeout format changes | Import breaks | Parser matches columns by name and tolerates extras; fixture tests; clear error showing the failing row |
| Geocoder rate limits or fair-use policy | Slow or blocked import | Cache every result, batch by area, switch to a hosted OSM geocoder's free tier |
| Safari clears storage | Data loss | Installed PWA, persistent storage request, backup reminders, later sync |
| Assistant invents saved places | Misleading answers | Facts only from tool results, place chips only for returned IDs, eval set |
| Model or provider changes on OpenRouter | Behavior shifts | Model IDs in settings, fallback list, run the eval before switching |
| Runaway agent loops | Unexpected bill | 6-round cap per turn, credit limit on the key, per-turn cost shown in the chat |
| Thin OSM coverage in some regions | Weak categories and recommendations | LLM classification from name and notes; optional web search check |

## Open decisions

The plan assumes React, TypeScript and Vite, public OSM geocoders and in-browser embeddings. Each item below can change that without affecting the overall structure.

- [x] Share a few rows of a real list CSV to confirm the format before phase 1
- [ ] Framework: React (assumed) or Svelte for a smaller bundle
- [ ] Geocoder: public Photon and Nominatim, or a hosted OSM geocoder's free tier
- [ ] Embeddings: in the browser (assumed, private) or through OpenRouter (simpler, better quality)
- [ ] Default chat model: pick after running the assistant eval on 2 or 3 candidates
- [ ] Sync: none, Cloudflare D1 behind a Worker, or a backup file in your cloud drive
- [ ] Visit logging: worth adding dates and ratings by hand, or keep lists as the only record
- [ ] Data Portability API: check whether it is available in your country

## Sources

- [Google Data Portability API, saved collections schema](https://developers.google.com/data-portability/schema-reference/save)
- [Google Data Portability API, time-based access](https://developers.google.com/data-portability/user-guide/time-based)
- [Google Maps Platform service specific terms (May 2024 version)](https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240522)
- [OpenRouter API reference](https://openrouter.ai/docs/api)
