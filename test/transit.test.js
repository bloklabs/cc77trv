import { describe, it, expect } from 'vitest'
import { haversineKm, estimateHop, budgetImpact, formatDuration } from '../src/lib/transit.js'

const tokyoStation = { lat: 35.6812, lng: 139.7671 }
const asakusa = { lat: 35.7148, lng: 139.7967 }

describe('haversineKm', () => {
  it('computes a plausible short city distance', () => {
    const d = haversineKm(tokyoStation, asakusa)
    expect(d).toBeGreaterThan(4)
    expect(d).toBeLessThan(7)
  })
  it('returns null for missing coords', () => {
    expect(haversineKm(null, asakusa)).toBeNull()
    expect(haversineKm({ lat: 1 }, { lng: 2 })).toBeNull()
  })
})

describe('estimateHop', () => {
  it('picks walk for very short hops', () => {
    const hop = estimateHop({ lat: 35.68, lng: 139.76 }, { lat: 35.685, lng: 139.762 })
    expect(hop.mode).toBe('walk')
    expect(hop.costUsd).toBe(0)
    expect(hop.minutes).toBeGreaterThan(0)
  })
  it('picks transit for a few km and adds cost', () => {
    const hop = estimateHop(tokyoStation, asakusa)
    expect(hop.mode).toBe('transit')
    expect(hop.minutes).toBeGreaterThan(5)
  })
  it('picks intercity for long distance', () => {
    const hop = estimateHop({ lat: 35.68, lng: 139.76 }, { lat: 34.69, lng: 135.5 })
    expect(hop.mode).toBe('intercity')
    expect(hop.km).toBeGreaterThan(300)
  })
})

describe('budgetImpact', () => {
  it('flags major spend', () => {
    const b = budgetImpact(500, 1000)
    expect(b.pct).toBe(50)
    expect(b.note).toBe('major spend')
    expect(b.remaining).toBe(500)
  })
  it('returns null without a budget', () => {
    expect(budgetImpact(50, 0)).toBeNull()
  })
})

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(120)).toBe('2h')
  })
})
