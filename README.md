# 🧭 Wander — cc & nana's shared travel wishlist

A mobile-first, installable **PWA** for saving places you want to eat at, stay in,
see and do around the world — then turning them into a plan.

**Live:** https://bloklabs.github.io/cc77trv/

Open it on your phone → **Share → Add to Home Screen** and it installs like a
native app (works offline).

## What it does

- **Quick save.** Paste any link (restaurant, hotel, blog, map pin) and Wander
  auto-fills the name, city, price, photo, and reservation hints by reading the
  page — no typing. Or add a spot by hand in two taps.
- **Normalized & sortable.** Every item is categorized (🍜 Eat · 🏨 Stay ·
  🏛️ See · 🎟️ Do · 🛍️ Shop) and geo-tagged, so you can filter by **city** and
  **category** and search instantly.
- **Map overlay.** See the whole wishlist as pins on a map, colored by category,
  filterable by city.
- **Agentic itinerary.** Pick a city and a start time and Wander orders the day
  by proximity (nearest-neighbour), estimates **transit mode + time** between
  stops, tallies **total cost** and **budget impact**, and flags anything that
  needs an **advance reservation** (with lead times).
- **Concierge export.** One tap copies a clean, structured blurb for a single
  place *or* a whole day plan — ready to hand to a human or agent concierge.
- **Shared, end-to-end encrypted.** Create a space, share the code with your
  travel buddy, and both wishlists stay in sync. Data is AES-GCM encrypted with
  a passphrase-derived key — the sync host only ever stores ciphertext.

## Architecture

Static PWA (Vite) — no server, no API keys, deployable anywhere.

| Concern | How |
| --- | --- |
| Enrichment | `src/lib/enrich.js` — fetches pages via a no-auth reader proxy, parses OpenGraph + JSON-LD |
| Normalization | `src/lib/normalize.js` — category / cost / reservation / geo detection |
| Geo + transit | `src/lib/geo.js`, `src/lib/transit.js` — city coords, haversine, mode/time/cost estimates |
| Itinerary | `src/lib/itinerary.js` — grouping, nearest-neighbour ordering, scheduling |
| Concierge blurbs | `src/lib/blurb.js` |
| Shared sync | `src/lib/sync.js` — jsonblob backend, AES-GCM E2E encryption, LWW merge |
| Local storage | `src/lib/store.js` — IndexedDB, offline-first |
| UI + map | `src/main.js` + Leaflet / OpenStreetMap |

## Develop

```bash
npm install
npm run dev       # http://localhost:5173/cc77trv/
npm test          # vitest unit suite (48 tests)
npm run build     # production build → dist/
```

### Tooling (Python, no third-party deps)

```bash
python3 tools/gen_icons.py                    # regenerate PWA icons
node tools/cdp_smoke.mjs <url> --shot out.png # headless boot/exercise smoke test
```

Deploys automatically to GitHub Pages via `.github/workflows/deploy.yml` on push
to `main`.

> **Note on CI:** `ci/github-pages.yml` is a ready-to-use GitHub Actions
> workflow. Move it to `.github/workflows/` (requires a token with `workflow`
> scope) to enable automatic test+deploy. This repo currently deploys to the
> `gh-pages` branch directly.
