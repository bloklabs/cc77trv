import { describe, it, expect } from 'vitest'
import { buildItinerary, groupByCity, nearestNeighbourOrder, collectReservations, parseTime, formatClock } from '../src/lib/itinerary.js'

const items = [
  { id: 'a', title: 'Far cafe', category: 'eat', city: 'Tokyo', lat: 35.71, lng: 139.79, visitMin: 60, costUsd: 20 },
  { id: 'b', title: 'Near shrine', category: 'see', city: 'Tokyo', lat: 35.681, lng: 139.767, visitMin: 45, costUsd: 0, reservation: { required: false, leadDays: 0 } },
  { id: 'c', title: 'Mid museum', category: 'see', city: 'Tokyo', lat: 35.69, lng: 139.77, visitMin: 90, costUsd: 15, reservation: { required: true, leadDays: 14, note: 'timed entry' } },
  { id: 'h', title: 'Hotel', category: 'stay', city: 'Tokyo', lat: 35.68, lng: 139.76 },
]

describe('groupByCity', () => {
  it('buckets items by city', () => {
    const g = groupByCity([...items, { id: 'x', title: 'no city' }])
    expect(g['Tokyo'].length).toBe(4)
    expect(g['Unsorted'].length).toBe(1)
  })
})

describe('nearestNeighbourOrder', () => {
  it('orders by proximity from a start point', () => {
    const start = { lat: 35.681, lng: 139.767 }
    const order = nearestNeighbourOrder(items.filter((i) => i.category !== 'stay'), start).map((i) => i.id)
    expect(order[0]).toBe('b') // nearest to start
    expect(order).toContain('a')
    expect(order).toContain('c')
  })
  it('handles single / empty lists', () => {
    expect(nearestNeighbourOrder([]).length).toBe(0)
    expect(nearestNeighbourOrder([items[0]]).length).toBe(1)
  })
})

describe('buildItinerary', () => {
  it('builds a timed schedule, excludes lodging from stops, and totals up', () => {
    const plan = buildItinerary(items, { startTime: '09:00', tripBudgetUsd: 500 })
    expect(plan.stops.length).toBe(3) // hotel excluded
    expect(plan.unlocated.some((i) => i.id === 'h')).toBe(true)
    expect(plan.totals.stops).toBe(3)
    expect(plan.totals.costUsd).toBeGreaterThan(0)
    expect(plan.totals.budget.pct).toBeGreaterThan(0)
    // first stop arrives exactly at start (no prior hop)
    expect(plan.stops[0].arriveLabel).toBe('9:00 AM')
    // times move forward
    expect(plan.stops[1].arrive).toBeGreaterThan(plan.stops[0].depart - 1)
  })
  it('surfaces reservations needing advance booking', () => {
    const plan = buildItinerary(items, {})
    expect(plan.reservations.length).toBe(1)
    expect(plan.reservations[0].title).toBe('Mid museum')
    expect(plan.reservations[0].leadDays).toBe(14)
  })
})

describe('collectReservations', () => {
  it('sorts by lead time descending', () => {
    const res = collectReservations([
      { title: 'x', reservation: { required: true, leadDays: 3 } },
      { title: 'y', reservation: { required: true, leadDays: 30 } },
    ])
    expect(res[0].title).toBe('y')
  })
})

describe('time helpers', () => {
  it('parseTime + formatClock round trip', () => {
    expect(parseTime('09:30')).toBe(570)
    expect(formatClock(570)).toBe('9:30 AM')
    expect(formatClock(13 * 60)).toBe('1:00 PM')
    expect(formatClock(0)).toBe('12:00 AM')
  })
})
