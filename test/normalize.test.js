import { describe, it, expect } from 'vitest'
import { normalizeItem, detectCategory, parseCost, detectReservation, cleanUrl, deriveTitleFromUrl } from '../src/lib/normalize.js'

describe('cleanUrl', () => {
  it('adds https and strips tracking params', () => {
    expect(cleanUrl('example.com/foo?utm_source=x&a=1')).toBe('https://example.com/foo?a=1')
  })
  it('rejects non-urls', () => {
    expect(cleanUrl('just some text')).toBeNull()
    expect(cleanUrl('')).toBeNull()
  })
})

describe('deriveTitleFromUrl', () => {
  it('humanizes the last path segment', () => {
    expect(deriveTitleFromUrl('https://site.com/best-ramen-shop')).toBe('Best Ramen Shop')
  })
})

describe('detectCategory', () => {
  it('classifies food, lodging, sights, activities', () => {
    expect(detectCategory('Michelin sushi omakase dinner')).toBe('eat')
    expect(detectCategory('boutique ryokan hotel with onsen')).toBe('stay')
    expect(detectCategory('ancient temple and shrine viewpoint')).toBe('see')
    expect(detectCategory('guided hiking tour ticket experience')).toBe('do')
  })
  it('falls back to other', () => {
    expect(detectCategory('xyzzy nothing here')).toBe('other')
  })
})

describe('parseCost', () => {
  it('parses symbol amounts and converts to usd', () => {
    expect(parseCost('$120 per night').usd).toBe(120)
    const yen = parseCost('¥8,000 omakase')
    expect(yen.currency).toBe('JPY')
    expect(yen.usd).toBeCloseTo(53.6, 1)
  })
  it('parses currency codes', () => {
    expect(parseCost('EUR 45 entry').currency).toBe('EUR')
  })
  it('returns null when no price', () => {
    expect(parseCost('free entry').usd).toBeNull()
  })
})

describe('detectReservation', () => {
  it('flags strong reservation language with long lead for omakase', () => {
    const r = detectReservation('omakase, reservation required', 'eat')
    expect(r.required).toBe(true)
    expect(r.leadDays).toBe(30)
  })
  it('marks lodging as needing early booking', () => {
    expect(detectReservation('nice hotel', 'stay').required).toBe(true)
  })
  it('no reservation for a casual park', () => {
    expect(detectReservation('a public park', 'see').required).toBe(false)
  })
})

describe('normalizeItem', () => {
  it('produces a consistent record and resolves city geo', () => {
    const it = normalizeItem({
      url: 'https://tabelog.com/tokyo/best-sushi?utm_medium=x',
      title: 'Sukiyabashi Jiro',
      description: 'Michelin omakase sushi, reservation required, ¥40,000',
      city: 'Tokyo',
    })
    expect(it.category).toBe('eat')
    expect(it.city).toBe('Tokyo')
    expect(it.lat).toBeCloseTo(35.6762, 2)
    expect(it.reservation.required).toBe(true)
    expect(it.costUsd).toBeGreaterThan(0)
    expect(it.url).toBe('https://tabelog.com/tokyo/best-sushi')
  })
  it('guesses city from free text when not provided', () => {
    const it = normalizeItem({ title: 'Great coffee in Kyoto near the station' })
    expect(it.city).toBe('Kyoto')
    expect(it.region).toBe('Asia')
  })
  it('is saveable with only a title', () => {
    const it = normalizeItem({ title: 'Some spot' })
    expect(it.title).toBe('Some spot')
    expect(it.category).toBeDefined()
  })
})
