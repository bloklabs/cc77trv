// Transit + budget estimation helpers. Pure functions, no I/O — heuristic
// but deterministic, so the itinerary builder can run fully offline.

const R_KM = 6371 // Earth radius

/** Great-circle distance between two {lat,lng} points, in km. */
export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Effective point-to-point speeds (km/h) accounting for stops, waits, and
// non-straight routes. Deliberately conservative for real-world planning.
const MODE_SPEED = { walk: 4.5, transit: 18, taxi: 26, intercity: 70 }

/**
 * Estimate travel between two geo points: chooses a sensible mode by distance
 * and returns minutes + a rough cost band.
 * @returns {{km:number, mode:string, minutes:number, costUsd:number}|null}
 */
export function estimateHop(a, b) {
  const km = haversineKm(a, b)
  if (km == null) return null
  let mode
  if (km <= 1.2) mode = 'walk'
  else if (km <= 12) mode = 'transit'
  else if (km <= 40) mode = 'taxi'
  else mode = 'intercity'
  const routeFactor = mode === 'walk' ? 1.25 : 1.35 // streets aren't straight lines
  const minutes = Math.round((km * routeFactor) / MODE_SPEED[mode] * 60)
  const costUsd = estimateHopCost(km, mode)
  return { km: round1(km), mode, minutes: Math.max(minutes, mode === 'walk' ? 1 : 3), costUsd }
}

function estimateHopCost(km, mode) {
  switch (mode) {
    case 'walk':
      return 0
    case 'transit':
      return 3 // flat fare-ish
    case 'taxi':
      return round1(4 + km * 2.2)
    default:
      return round1(20 + km * 0.35) // intercity rail/bus band
  }
}

/**
 * Given an item's estimated cost + a total trip budget, return the share of
 * budget it consumes and a human "time to budget" note.
 */
export function budgetImpact(itemCostUsd, tripBudgetUsd) {
  if (!tripBudgetUsd || tripBudgetUsd <= 0 || itemCostUsd == null) return null
  const pct = (itemCostUsd / tripBudgetUsd) * 100
  return {
    pct: round1(pct),
    remaining: round1(tripBudgetUsd - itemCostUsd),
    note: pct >= 25 ? 'major spend' : pct >= 8 ? 'moderate' : 'minor',
  }
}

export function formatDuration(minutes) {
  if (minutes == null) return '—'
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function round1(n) {
  return Math.round(n * 10) / 10
}
