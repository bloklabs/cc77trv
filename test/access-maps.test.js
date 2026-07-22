import { describe, it, expect } from 'vitest'
import { normalizeItem, bookingDifficulty, buildMapsUrl, ACCESS_TIERS } from '../src/lib/normalize.js'
import { deriveFromUrl, cleanTitle } from '../src/lib/enrich.js'

describe('access tiers (walk-in / reservation / concierge)', () => {
  it('flags famous hard tables as concierge', () => {
    expect(bookingDifficulty({ title: 'Plénitude', category: 'eat', text: 'plénitude cheval blanc' }).tier).toBe('concierge')
    expect(bookingDifficulty({ title: 'Septime', category: 'eat', text: 'septime' }).tier).toBe('concierge')
    expect(bookingDifficulty({ title: 'Arpège', category: 'eat', text: 'arpège michelin 3-star' }).tier).toBe('concierge')
  })
  it('marks a coffee bar as walk-in', () => {
    expect(bookingDifficulty({ title: 'Motors Espresso', category: 'eat', text: 'tiny specialty espresso bar' }).tier).toBe('walkin')
  })
  it('marks a normal bistro as reservation', () => {
    const t = bookingDifficulty({ title: 'Le Bon Georges', category: 'eat', text: 'paris bistro' }).tier
    expect(['reservation', 'concierge']).toContain(t)
  })
  it('honours an explicit override', () => {
    const b = bookingDifficulty({ title: 'Some Cafe', category: 'eat', text: 'cafe', override: 'concierge' })
    expect(b.tier).toBe('concierge')
    expect(b.score).toBe(5)
  })
  it('normalizeItem exposes booking.tier + persists access override', () => {
    const it = normalizeItem({ title: 'Septime', category: 'eat', city: 'Paris' })
    expect(it.booking.tier).toBe('concierge')
    expect(it.booking.tierLabel).toBe('Concierge')
    const o = normalizeItem({ title: 'Corner Cafe', category: 'eat', access: 'reservation' })
    expect(o.access).toBe('reservation')
    expect(o.booking.tier).toBe('reservation')
  })
})

describe('every item gets a maps link', () => {
  it('builds a google maps search url from title + city', () => {
    const url = buildMapsUrl('Noble Rot', 'London')
    expect(url).toContain('google.com/maps/search')
    expect(url).toContain('Noble')
  })
  it('normalizeItem always sets mapsUrl, even with no source link', () => {
    const it = normalizeItem({ title: 'Random Spot', city: 'Tokyo' })
    expect(it.url).toBeNull()
    expect(it.mapsUrl).toContain('google.com/maps')
  })
})

describe('deriveFromUrl — instagram + fallbacks', () => {
  it('humanizes an instagram handle', () => {
    expect(deriveFromUrl('https://www.instagram.com/septime_paris/').title).toBe('Septime Paris')
  })
  it('does not invent a name for a post/reel without a handle', () => {
    expect(deriveFromUrl('https://instagram.com/p/C1abc/').title).toBe('Instagram find')
  })
  it('humanizes a normal path slug', () => {
    expect(deriveFromUrl('https://site.com/best-ramen-shop').title).toBe('Best Ramen Shop')
  })
})

describe('cleanTitle', () => {
  it('strips instagram + site suffixes', () => {
    expect(cleanTitle('Septime (@septime_paris) • Instagram photos and videos')).toBe('Septime')
    expect(cleanTitle('Noble Rot - Google Maps')).toBe('Noble Rot')
  })
})
