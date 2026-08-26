# 🌸 OS3 Concierge

Offline-first family research for travel, food, beverage, wine, art,
entertainment, and any service that can improve a family's utility.

**Live:** https://bloklabs.github.io/os3-concierge/

Open it on a phone, then use **Share → Add to Home Screen**. The PWA keeps the
latest list on-device and remains useful without a connection.

## What it does

- **Instant capture.** Paste a place, service, article, map pin, or list. It is
  saved to IndexedDB first, then enriched when the network is available.
- **Broad research taxonomy.** Filter independently by travel, food, beverage,
  wine, art, entertainment, or family utility. Existing Eat, Stay, See, Do,
  Shop, and Other categories remain available and unchanged.
- **Family utility.** Research can cover education, healthcare, security,
  household services, property, private aviation, yachting, philanthropy,
  family-office work, and other high-net-worth family needs.
- **Map and itinerary.** Map saved places, order a day by proximity, estimate
  transit and cost, and surface reservation lead times.
- **Concierge handoff.** Copy one item or a complete day as structured text for
  a human or agent concierge.
- **Private shared spaces.** The original end-to-end encrypted shared-list
  protocol remains supported. The sync host sees ciphertext only.

## Wander / CC77 compatibility

The repository and visible app were renamed; user data was not.

- IndexedDB remains `wander`, version `1`, store `items`.
- Local settings remain `wander.space`, `wander.seeded`, `wander.ac.*`, and
  `wander.geo`.
- Share codes remain `wander1.*`.
- PBKDF2 remains `100000` iterations with salt `wander-cc77-v1`.
- Encrypted payloads retain the `wander: 1` marker.
- GitHub redirects the old `bloklabs/cc77trv` repository and Pages URL to the
  canonical name. Both Pages paths share the same browser origin, so existing
  IndexedDB and localStorage remain available.

These values are centralized in `src/lib/compat.js` and pinned by tests. Do not
rename them as part of future branding work.

## Architecture

Static Vite PWA. No application server or API key is required.

| Concern | Implementation |
| --- | --- |
| Normalization and research domains | `src/lib/normalize.js` |
| Offline source of truth | `src/lib/store.js` |
| Encrypted shared sync | `src/lib/sync.js` |
| Enrichment | `src/lib/enrich.js` and `src/lib/gather.js` |
| Geo, transit, and itinerary | `src/lib/geo.js`, `src/lib/transit.js`, `src/lib/itinerary.js` |
| UI and map | `src/main.js`, Leaflet, OpenStreetMap |
| Compatibility contract | `src/lib/compat.js` |

## Develop

```bash
npm ci
npm run dev
npm test
npm run lint
npm run build
```

Local Vite defaults to `http://localhost:5173/os3-concierge/`. GitHub Actions
sets `PUBLIC_BASE` from the current repository name, which keeps the same
commit deployable immediately before and after a repository rename.

## Tailnet X-ray workbench

```bash
npm run xray
```

The launcher:

- resolves exactly one local IPv4 from `tailscale status --json`;
- binds only that exact Tailnet address on direct HTTP port `7723`;
- refuses protected ports `443`, `8443`, and `10000`;
- enables a visible `X-RAY` marker and disables encrypted shared-space sync;
- publishes only `{ "url": "..." }` atomically to `.nerv/xray.json` after a
  real HTTP readiness check.

It never changes Tailscale Serve configuration. X-ray data is local to its
distinct Tailnet-IP/port origin.

## Delivery

`.github/workflows/deploy.yml` runs tests, lint, and the production build on
every pull request and push to `main`. A green `main` deploys GitHub Pages.
