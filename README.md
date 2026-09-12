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
- **Restaurant voice.** Launch authenticated OS3 speech or restaurant calls with
  your place details. Import phrases and call reports for offline reading;
  device speech is a labelled fallback. The first voice release opens
  [OS3 staging](https://staging.os.unitary.com), visibly labelled in Concierge.
  See [voice account setup](docs/voice-setup.md).
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

Static Vite PWA. Research needs no application server or API key. Paid voice
opens the authenticated OS3 app; provider keys stay on its server. The voice
handoff uses bounded, one-use URL fragments and a separate local-only store.

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

This isolated title-readability release line starts from the saved Pages
release `b7d36525f06dcd9353bc796c417f509a419ddc97`. It keeps the held mission UI
on `main` separate; the `main` branch and its workflow are unchanged.

On this line, `.github/workflows/deploy.yml` tests pull requests and pushes
targeting `main` or the single branch `release/concierge-readable-titles`.
Pull requests never upload or deploy. Only a push or guarded dispatch of
the exact release ref may publish, after audit, tests, lint, build and browser
checks pass. The case-sensitive ref check rejects similarly named refs.

Before merging or publishing, require independent approval and green CI for
the exact feature head, and verify that the existing `github-pages`
environment admits this exact release branch. This workflow does not grant
environment admission. If the branch is excluded, hold publication; do not
broaden the environment policy or publish the held `main` as a workaround.
The Pages URL and all storage identities above remain unchanged.

The voice design was agreed by Fable 5.1 and Astra before implementation.
See the [original spec](docs/specs/restaurant-voice.md) and
[agreed OS3 design](https://github.com/unitary-internal/unitary-os3/blob/staging/docs/specs/restaurant-voice-design.md).
