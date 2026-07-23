import { describe, it, expect } from 'vitest'
import { isGoogleLink, isShortGoogleLink, parseGooglePlace, resolveGoogle } from '../src/lib/google.js'

describe('isGoogleLink / isShortGoogleLink', () => {
  it('recognises maps + share + short links', () => {
    expect(isGoogleLink('https://www.google.com/maps/place/Septime/@48.85,2.38,17z')).toBe(true)
    expect(isGoogleLink('https://maps.app.goo.gl/abcd')).toBe(true)
    expect(isGoogleLink('https://share.google/goUL6uahjlr30xC33')).toBe(true)
    expect(isGoogleLink('https://maps.google.com/?q=Noble+Rot')).toBe(true)
    expect(isGoogleLink('https://example.com/foo')).toBe(false)
  })
  it('flags the short ones that need resolving', () => {
    expect(isShortGoogleLink('https://share.google/x')).toBe(true)
    expect(isShortGoogleLink('https://maps.app.goo.gl/x')).toBe(true)
    expect(isShortGoogleLink('https://www.google.com/maps/place/X/@1,2')).toBe(false)
  })
})

describe('parseGooglePlace', () => {
  it('reads name + coords from a /maps/place URL', () => {
    const g = parseGooglePlace('https://www.google.com/maps/place/Septime/@48.8536,2.3809,17z/data=!3d48.8536!4d2.3809')
    expect(g.name).toBe('Septime')
    expect(g.lat).toBeCloseTo(48.8536, 3)
    expect(g.lng).toBeCloseTo(2.3809, 3)
  })
  it('reads a name from a q= param (resolved search URL / text)', () => {
    const text = 'URL Source: https://www.google.com/search?hl=en&q=Les+enfants+du+march%C3%A9&kgmid=/g/11'
    const g = parseGooglePlace(text)
    expect(g.name).toBe('Les enfants du marché')
  })
  it('reads coords from a q=lat,lng param', () => {
    const g = parseGooglePlace('https://maps.google.com/?q=35.6762,139.6503')
    expect(g.lat).toBeCloseTo(35.6762, 3)
    expect(g.lng).toBeCloseTo(139.6503, 3)
    expect(g.name).toBeNull()
  })
  it('returns empty for a non-place url', () => {
    expect(parseGooglePlace('https://example.com')).toEqual({ name: null, lat: null, lng: null })
  })
})

describe('resolveGoogle', () => {
  it('parses a full maps URL directly (no fetch)', async () => {
    const g = await resolveGoogle('https://www.google.com/maps/place/Noble+Rot/@51.52,-0.12,17z')
    expect(g.name).toBe('Noble Rot')
  })
  it('resolves a short share link via the reader proxy', async () => {
    const resolvedDump = 'Title: https://www.google.com/search?q=Les+enfants+du+march%C3%A9&kgmid=/g/11\nURL Source: https://share.google/x'
    const fetchImpl = async (u) => {
      expect(u).toContain('r.jina.ai')
      return { ok: true, text: async () => resolvedDump }
    }
    const g = await resolveGoogle('https://share.google/goUL6uahjlr30xC33', { fetchImpl })
    expect(g.name).toBe('Les enfants du marché')
  })
  it('degrades gracefully when the proxy fails', async () => {
    const fetchImpl = async () => { throw new Error('offline') }
    const g = await resolveGoogle('https://share.google/x', { fetchImpl })
    expect(g).toEqual({ name: null, lat: null, lng: null })
  })
})
