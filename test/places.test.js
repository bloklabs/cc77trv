import { describe, it, expect } from 'vitest'
import { parseNominatim, osmCategory, lookupPlace, reverseLookup } from '../src/lib/places.js'

const SEPTIME = [{
  name: 'Septime', category: 'amenity', type: 'restaurant',
  lat: '48.8536', lon: '2.3809',
  display_name: 'Septime, 80, Rue de Charonne, Paris, France',
  address: { restaurant: 'Septime', road: 'Rue de Charonne', city: 'Paris', country: 'France' },
  extratags: { cuisine: 'french', opening_hours: 'Mo 19:00-22:30; Tu-Fr 12:15-14:00,19:00-22:30', website: 'https://septime-charonne.fr' },
}]

describe('osmCategory', () => {
  it('maps types + classes to our categories', () => {
    expect(osmCategory('amenity', 'restaurant')).toBe('eat')
    expect(osmCategory('tourism', 'hotel')).toBe('stay')
    expect(osmCategory('tourism', 'museum')).toBe('see')
    expect(osmCategory('shop', 'bakery')).toBe('eat') // type wins over class
    expect(osmCategory('shop', 'clothes')).toBe('shop')
    expect(osmCategory('historic', 'castle')).toBe('see')
    expect(osmCategory('amenity', 'townhall')).toBe('other')
  })
})

describe('parseNominatim', () => {
  it('extracts coords, city, category, website, hours, snippet', () => {
    const p = parseNominatim(SEPTIME)
    expect(p.title).toBe('Septime')
    expect(p.lat).toBeCloseTo(48.8536, 3)
    expect(p.city).toBe('Paris')
    expect(p.country).toBe('France')
    expect(p.category).toBe('eat')
    expect(p.website).toBe('https://septime-charonne.fr')
    expect(p.hoursByDay[2]).toContain('12:15') // Tuesday
    expect(p.snippet).toContain('French')
    expect(p.source).toBe('lookup')
  })
  it('returns null for empty results', () => {
    expect(parseNominatim([])).toBeNull()
    expect(parseNominatim(null)).toBeNull()
  })
  it('falls back to display_name when no name', () => {
    const p = parseNominatim([{ lat: '1', lon: '2', display_name: 'Cool Bar, Tokyo', address: {} }])
    expect(p.title).toBe('Cool Bar')
  })
})

describe('lookupPlace (injected fetch)', () => {
  it('queries nominatim and returns a normalized partial', async () => {
    let calledUrl = ''
    const fetchImpl = async (u) => { calledUrl = u; return { ok: true, json: async () => SEPTIME } }
    const p = await lookupPlace('Septime', { fetchImpl, city: 'Paris' })
    expect(calledUrl).toContain('nominatim')
    expect(calledUrl).toContain('Septime')
    expect(calledUrl).toContain('Paris')
    expect(p.city).toBe('Paris')
  })
})

describe('reverseLookup (injected fetch)', () => {
  it('reverse-geocodes coords', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => SEPTIME[0] })
    const p = await reverseLookup(48.85, 2.38, { fetchImpl })
    expect(p.title).toBe('Septime')
  })
})
