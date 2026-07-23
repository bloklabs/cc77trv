// Proximity alerts: which saved places are within a radius of the user's
// current position. Pure + testable; the geolocation/notification wiring lives
// in main.js. Everything on the wishlist counts as a "liked" place.

import { haversineKm } from './transit.js'

/**
 * Places within `radiusM` metres of (lat,lng), nearest first.
 * @returns {Array<{item:object, distanceM:number}>}
 */
export function nearbyPlaces(lat, lng, items, radiusM = 100) {
  if (lat == null || lng == null || !Array.isArray(items)) return []
  const here = { lat, lng }
  const out = []
  for (const item of items) {
    if (item.lat == null || item.lng == null) continue
    const km = haversineKm(here, item)
    if (km == null) continue
    const distanceM = km * 1000
    if (distanceM <= radiusM) out.push({ item, distanceM: Math.round(distanceM) })
  }
  return out.sort((a, b) => a.distanceM - b.distanceM)
}

/**
 * Decide whether to alert for a place now: within radius AND not alerted within
 * the cooldown window. `lastNotified` is a map of id → epoch ms. Pure so it's
 * unit-testable; caller updates the map on a returned alert.
 */
export function alertsToFire(lat, lng, items, opts = {}) {
  const radiusM = opts.radiusM ?? 100
  const cooldownMs = opts.cooldownMs ?? 60 * 60 * 1000 // 1h per place
  const now = opts.now ?? 0
  const lastNotified = opts.lastNotified || {}
  return nearbyPlaces(lat, lng, items, radiusM).filter(({ item }) => {
    const last = lastNotified[item.id] || 0
    return now - last >= cooldownMs
  })
}
