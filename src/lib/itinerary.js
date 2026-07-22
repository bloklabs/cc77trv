// Agentic itinerary builder. Given wishlist items, group by city and order a
// day's stops by proximity (nearest-neighbour), estimating transit time
// between stops, visit time, total cost, and surfacing reservation lead-times.

import { estimateHop, haversineKm, formatDuration, budgetImpact } from './transit.js'
import { CATEGORY_META } from './normalize.js'

/** Group items by their resolved city (items without a city → 'Unsorted'). */
export function groupByCity(items) {
  const groups = {}
  for (const it of items) {
    const key = it.city || 'Unsorted'
    ;(groups[key] = groups[key] || []).push(it)
  }
  return groups
}

/**
 * Order stops by nearest-neighbour and build a timed schedule.
 * @param {Array} items - wishlist items (ideally same city, with lat/lng)
 * @param {object} opts - { startTime:'09:00', startPoint:{lat,lng}, tripBudgetUsd, includeUnlocated:true }
 */
export function buildItinerary(items, opts = {}) {
  const startMin = parseTime(opts.startTime || '09:00')
  const located = items.filter((i) => i.lat != null && i.lng != null && (i.category || 'other') !== 'stay')
  const unlocated = items.filter((i) => !(i.lat != null && i.lng != null) || i.category === 'stay')

  const ordered = nearestNeighbourOrder(located, opts.startPoint)

  const stops = []
  let clock = startMin
  let prev = opts.startPoint || null
  let distanceKm = 0
  let transitMin = 0
  let visitMin = 0
  let costUsd = 0

  for (const item of ordered) {
    const hop = prev ? estimateHop(prev, item) : null
    if (hop) {
      clock += hop.minutes
      distanceKm += hop.km
      transitMin += hop.minutes
      costUsd += hop.costUsd
    }
    const arrive = clock
    const dwell = item.visitMin || CATEGORY_META[item.category || 'other'].defaultVisitMin || 60
    clock += dwell
    visitMin += dwell
    if (item.costUsd) costUsd += item.costUsd
    stops.push({
      item,
      hopFromPrev: hop,
      arrive,
      depart: clock,
      arriveLabel: formatClock(arrive),
      departLabel: formatClock(clock),
    })
    prev = item
  }

  const reservations = collectReservations(items)
  const totals = {
    stops: stops.length,
    distanceKm: round1(distanceKm),
    transitMin,
    visitMin,
    totalMin: transitMin + visitMin,
    costUsd: round1(costUsd),
    endLabel: stops.length ? formatClock(clock) : formatClock(startMin),
  }
  if (opts.tripBudgetUsd) totals.budget = budgetImpact(costUsd, opts.tripBudgetUsd)

  return { stops, unlocated, totals, reservations }
}

/** Greedy nearest-neighbour ordering from an optional start point. */
export function nearestNeighbourOrder(items, startPoint) {
  const remaining = [...items]
  if (remaining.length <= 1) return remaining
  const ordered = []
  let cursor = startPoint || remaining[0]
  if (!startPoint) ordered.push(remaining.shift())
  else cursor = startPoint
  while (remaining.length) {
    let bestIdx = 0
    let bestDist = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(cursor, remaining[i]) ?? Infinity
      if (d < bestDist) {
        bestDist = d
        bestIdx = i
      }
    }
    const next = remaining.splice(bestIdx, 1)[0]
    ordered.push(next)
    cursor = next
  }
  return ordered
}

/** Reservations that need advance booking, sorted by longest lead time first. */
export function collectReservations(items) {
  return items
    .filter((i) => i.reservation && (i.reservation.required || (i.reservation.leadDays || 0) > 0))
    .map((i) => ({
      title: i.title,
      leadDays: i.reservation.leadDays || 0,
      note: i.reservation.note || 'Reservation recommended',
      url: i.url || null,
    }))
    .sort((a, b) => b.leadDays - a.leadDays)
}

// --- time helpers ---
export function parseTime(t) {
  if (typeof t === 'number') return t
  const m = String(t).match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return 9 * 60
  return Math.min(23 * 60 + 59, parseInt(m[1], 10) * 60 + parseInt(m[2], 10))
}

export function formatClock(min) {
  const total = ((min % 1440) + 1440) % 1440
  const h = Math.floor(total / 60)
  const m = total % 60
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function round1(n) {
  return Math.round(n * 10) / 10
}
