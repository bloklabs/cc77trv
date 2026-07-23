import { describe, it, expect } from 'vitest'
import { gatherInfo } from '../src/lib/gather.js'

const NOMINATIM_HTML = null

describe('gatherInfo routing', () => {
  it('a bare name → place lookup (nominatim)', async () => {
    const fetchImpl = async (u) => {
      expect(u).toContain('nominatim')
      return { ok: true, json: async () => [{ name: 'Noble Rot', type: 'restaurant', class: 'amenity', lat: '51.5', lon: '-0.13', address: { city: 'London' }, extratags: {} }] }
    }
    const info = await gatherInfo({ title: 'Noble Rot', city: 'London' }, { fetchImpl })
    expect(info.city).toBe('London')
    expect(info.category).toBe('eat')
  })

  it('a Google share link → resolve then look up', async () => {
    const fetchImpl = async (u) => {
      if (u.includes('r.jina.ai')) return { ok: true, text: async () => 'q=Septime+Paris' }
      // nominatim
      return { ok: true, json: async () => [{ name: 'Septime', type: 'restaurant', class: 'amenity', lat: '48.85', lon: '2.38', address: { city: 'Paris' }, extratags: {} }] }
    }
    const info = await gatherInfo({ url: 'https://share.google/goUL6uahjlr30xC33' }, { fetchImpl })
    expect(info.title).toBe('Septime')
    expect(info.city).toBe('Paris')
    expect(info.mapsRef).toContain('share.google')
  })

  it('a full maps place URL → look up the name (no resolve fetch needed)', async () => {
    let nominatimQ = ''
    const fetchImpl = async (u) => {
      nominatimQ = u
      return { ok: true, json: async () => [{ name: 'Septime', type: 'restaurant', class: 'amenity', lat: '48.85', lon: '2.38', address: { city: 'Paris' }, extratags: {} }] }
    }
    const info = await gatherInfo({ url: 'https://www.google.com/maps/place/Septime/@48.85,2.38,17z' }, { fetchImpl })
    expect(nominatimQ).toContain('Septime')
    expect(info.lat).toBeCloseTo(48.85, 2)
  })

  it('a normal link → page enrichment', async () => {
    const html = '<meta property="og:title" content="Best Ramen"><meta property="og:description" content="A cozy ramen shop.">'
    const fetchImpl = async () => ({ ok: true, text: async () => html })
    const info = await gatherInfo({ url: 'https://ramen.example/best' }, { fetchImpl })
    expect(info.title).toBe('Best Ramen')
    expect(info.source).toBe('enriched')
  })

  it('nothing to go on → null', async () => {
    expect(await gatherInfo({})).toBeNull()
  })
})
