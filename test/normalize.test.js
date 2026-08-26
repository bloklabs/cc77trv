import { describe, it, expect } from 'vitest'
import {
  CATEGORIES, DOMAINS, normalizeItem, detectCategory, detectDomain,
  parseCost, detectReservation, cleanUrl, deriveTitleFromUrl,
} from '../src/lib/normalize.js'

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

describe('research domains', () => {
  it('covers every OS3 Concierge research area', () => {
    expect(DOMAINS).toEqual([
      'travel', 'food', 'beverage', 'wine', 'art', 'entertainment', 'family',
    ])
    expect(detectDomain('private villa travel itinerary', 'stay')).toBe('travel')
    expect(detectDomain('chef tasting menu restaurant', 'eat')).toBe('food')
    expect(detectDomain('rare whisky and cocktail research', 'eat')).toBe('beverage')
    expect(detectDomain('Burgundy vineyard and wine cellar', 'eat')).toBe('wine')
    expect(detectDomain('gallery exhibition and art auction', 'see')).toBe('art')
    expect(detectDomain('opera theatre premiere', 'do')).toBe('entertainment')
    expect(detectDomain('family office private aviation security', 'other')).toBe('family')
  })

  it('keeps specific wine and beverage matches ahead of food', () => {
    expect(detectDomain('wine pairing dinner', 'eat')).toBe('wine')
    expect(detectDomain('coffee bar breakfast', 'eat')).toBe('beverage')
  })

  it('preserves an explicit valid domain and defaults legacy records safely', () => {
    expect(normalizeItem({ title: 'A museum cafe', category: 'see', domain: 'family' }).domain).toBe('family')
    expect(normalizeItem({ title: 'Unknown saved thing', category: 'other' }).domain).toBe('travel')
  })

  it('does not replace or rename the legacy category contract', () => {
    expect(CATEGORIES).toEqual(['eat', 'stay', 'see', 'do', 'shop', 'other'])
    const item = normalizeItem({ title: 'Bordeaux cellar visit', category: 'do' })
    expect(item.category).toBe('do')
    expect(item.domain).toBe('wine')
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
    expect(it.domain).toBe('food')
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
