# Oahu Neighborhood Finder — Design

**Date:** 2026-04-13

## Overview

A standalone static HTML/JS web tool. User types a property address on Oahu, the tool geocodes it, runs point-in-polygon against two neighborhood boundary layers, and displays the matched neighborhood names, polygon highlights on a map, and demographic metadata.

---

## Architecture

```
User types address
      ↓
Nominatim geocoder (OpenStreetMap, free, no API key, Oahu bbox)
      ↓
lat/lng point
      ↓
Turf.js point-in-polygon against two preloaded GeoJSON datasets:
  • Neighborhood Boards GeoJSON (33 polygons)
  • MLS Neighborhoods GeoJSON (placeholder → swap when MLS access arrives)
      ↓
Matched polygon(s) highlighted on Leaflet.js map
      ↓
Info panel: names + boundaries + demographic metadata
```

**Libraries:**
- `Leaflet.js` — map rendering, no API key required
- `Turf.js` — point-in-polygon, runs entirely in browser
- `Nominatim` — geocoding, free, rate-limited to 1 req/sec

---

## Data Sources

### Layer 1 — Neighborhood Boards (live now)
- **Source:** City & County of Honolulu Open Geospatial Data Portal
  `https://honolulu-cchnl.opendata.arcgis.com`
- 33 official board polygons + sub-district boundaries
- Free download, no auth required
- **Demographic metadata:** DPP Neighborhood Profiles (population, median HH income, housing units, race/ethnicity)
  `https://www.honolulu.gov/dpp/resources/neighborhood-profiles-by-plan-area/`

### Layer 2 — MLS Neighborhoods (placeholder → real data coming)
- **Now:** uses Neighborhood Board polygons, labeled "Public Boundary (MLS coming soon)"
- **Later:** export HiCentral MLS neighborhood polygons → drop in as replacement GeoJSON
- Swap is a one-line change: `const MLS_READY = false` → `true`

### File Structure
```
_Neighborhood_Finder/
  index.html
  data/
    neighborhood_boards.geojson     ← Honolulu Open Data download
    neighborhood_metadata.json      ← DPP demographic data, keyed by board name
    mls_neighborhoods.geojson       ← placeholder (mirrors boards for now)
```

---

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│  Oahu Neighborhood Finder                            │
│  ┌─────────────────────────────────────┐  [Search]  │
│  │ Enter address...                    │            │
│  └─────────────────────────────────────┘            │
├─────────────────────────────┬───────────────────────┤
│                             │  NEIGHBORHOOD BOARD   │
│                             │  Manoa                │
│       Leaflet Map           │  ─────────────────    │
│   (highlighted polygon)     │  MLS REGION           │
│                             │  Manoa-Lower (est.)   │
│                             │  ─────────────────    │
│                             │  DEMOGRAPHICS         │
│                             │  Pop: 12,450          │
│                             │  Median HH Income:    │
│                             │  $98,200              │
│                             │  Housing Units: 4,820 │
└─────────────────────────────┴───────────────────────┘
```

**Interactions:**
- Enter or button click triggers geocode (debounced)
- Matched polygon fills + borders on map, map pans/zooms to fit
- If address spans multiple boundaries, show all matches
- "MLS data coming soon" badge until `MLS_READY = true`
- Mobile: single-column stacked (map top, info panel below)

---

## Code Flow

```js
onSearch(address)
  → geocode(address)                              // Nominatim, Oahu bbox
  → pointInPolygon(lat, lng, boardsGeoJSON)       // Turf.js
  → pointInPolygon(lat, lng, mlsGeoJSON)          // Turf.js
  → renderMatch(boardMatch, mlsMatch)             // highlight + panel
```

**MLS swap hook:**
```js
const MLS_READY = false;  // flip to true when mls_neighborhoods.geojson is real
```

---

## Error Handling

| Condition | User-facing message |
|---|---|
| Address not found | "No results. Try a street address on Oahu." |
| Address outside all polygons | "Address is on Oahu but outside known boundaries." |
| Nominatim rate limit | Retry once after 1s → "Try again in a moment." |
| GeoJSON files fail to load | Banner warning, search disabled |

---

## Data Acquisition Steps (before building)

1. Download `neighborhood_boards.geojson` from Honolulu Open Data Portal
2. Download DPP Neighborhood Profiles data → convert to `neighborhood_metadata.json`
3. Copy `neighborhood_boards.geojson` → `mls_neighborhoods.geojson` as placeholder
4. When HiCentral MLS access arrives: export MLS neighborhood polygons → replace `mls_neighborhoods.geojson`, set `MLS_READY = true`

---

## Out of Scope (MVP)

- Backend / API endpoint
- User accounts or saved searches
- Other islands
- Building permit or TMK lookup
- Mobile app
