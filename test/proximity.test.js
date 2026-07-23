import { describe, it, expect } from 'vitest'
import { nearbyPlaces, alertsToFire } from '../src/lib/proximity.js'

const items = [
  { id: 'a', title: 'Right here', lat: 48.8536, lng: 2.3809 },
  { id: 'b', title: '~80m away', lat: 48.85432, lng: 2.3809 }, // ~80m north
  { id: 'c', title: 'Far', lat: 48.86, lng: 2.40 },
  { id: 'd', title: 'No coords' },
]

describe('nearbyPlaces', () => {
  it('returns places within the radius, nearest first', () => {
    const near = nearbyPlaces(48.8536, 2.3809, items, 100)
    expect(near.map((n) => n.item.id)).toEqual(['a', 'b'])
    expect(near[0].distanceM).toBe(0)
    expect(near[1].distanceM).toBeGreaterThan(50)
    expect(near[1].distanceM).toBeLessThan(100)
  })
  it('excludes far places and ones without coords', () => {
    const near = nearbyPlaces(48.8536, 2.3809, items, 100)
    expect(near.find((n) => n.item.id === 'c')).toBeUndefined()
    expect(near.find((n) => n.item.id === 'd')).toBeUndefined()
  })
  it('handles missing position gracefully', () => {
    expect(nearbyPlaces(null, null, items)).toEqual([])
  })
})

describe('alertsToFire (cooldown)', () => {
  it('fires for nearby places not alerted within the cooldown', () => {
    const fire = alertsToFire(48.8536, 2.3809, items, { now: 10_000_000, lastNotified: {} })
    expect(fire.map((f) => f.item.id)).toEqual(['a', 'b'])
  })
  it('suppresses places alerted recently', () => {
    const now = 10_000_000
    const fire = alertsToFire(48.8536, 2.3809, items, {
      now, cooldownMs: 60_000, lastNotified: { a: now - 30_000, b: now - 120_000 },
    })
    expect(fire.map((f) => f.item.id)).toEqual(['b']) // a still cooling down
  })
})
