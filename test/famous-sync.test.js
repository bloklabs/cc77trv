import { describe, it, expect } from 'vitest'
import { searchFamous, FAMOUS } from '../src/lib/famous.js'
import { nominatimSuggest } from '../src/lib/places.js'
import { fetchRetry, SyncClient, deriveKey, encryptPayload, decryptPayload } from '../src/lib/sync.js'

describe('searchFamous (offline autocomplete)', () => {
  it('prefix matches rank first', () => {
    const r = searchFamous('eiff')
    expect(r[0].name).toBe('Eiffel Tower')
  })
  it('matches by city and substring', () => {
    const r = searchFamous('septime')
    expect(r.some((p) => p.name === 'Septime')).toBe(true)
    const tokyo = searchFamous('tokyo')
    expect(tokyo.length).toBeGreaterThan(0)
    expect(tokyo.every((p) => (p.city + p.name).toLowerCase().includes('tokyo'))).toBe(true)
  })
  it('needs at least 2 chars and caps results', () => {
    expect(searchFamous('e')).toEqual([])
    expect(searchFamous('a', 3).length).toBeLessThanOrEqual(3)
  })
  it('every entry has coords + category (offline-usable)', () => {
    for (const p of FAMOUS) {
      expect(typeof p.lat).toBe('number')
      expect(typeof p.lng).toBe('number')
      expect(p.category).toBeTruthy()
    }
  })
})

describe('nominatimSuggest', () => {
  it('maps multiple results to suggestion shape', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => [
      { name: 'Septime', type: 'restaurant', class: 'amenity', lat: '48.85', lon: '2.38', address: { city: 'Paris', country: 'France' } },
      { name: 'Septime La Cave', type: 'bar', class: 'amenity', lat: '48.85', lon: '2.38', address: { city: 'Paris' } },
    ] })
    const s = await nominatimSuggest('septime', { fetchImpl })
    expect(s.length).toBe(2)
    expect(s[0]).toMatchObject({ title: 'Septime', city: 'Paris', category: 'eat' })
  })
})

describe('fetchRetry (sync resilience)', () => {
  it('retries transient 5xx/429 then succeeds', async () => {
    let n = 0
    const fetchImpl = async () => {
      n++
      if (n < 3) return { ok: false, status: n === 1 ? 500 : 429 }
      return { ok: true, status: 200 }
    }
    const res = await fetchRetry(fetchImpl, 'x', {}, 4)
    expect(res.ok).toBe(true)
    expect(n).toBe(3)
  })
  it('retries on network errors', async () => {
    let n = 0
    const fetchImpl = async () => { n++; if (n < 2) throw new Error('network'); return { ok: true, status: 200 } }
    const res = await fetchRetry(fetchImpl, 'x', {}, 3)
    expect(res.ok).toBe(true)
  })
  it('does not retry a normal 4xx', async () => {
    let n = 0
    const fetchImpl = async () => { n++; return { ok: false, status: 400 } }
    const res = await fetchRetry(fetchImpl, 'x', {}, 4)
    expect(res.status).toBe(400)
    expect(n).toBe(1)
  })
})

describe('SyncClient.push survives a flaky PUT (retry)', () => {
  it('pushes after transient failures', async () => {
    const key = await deriveKey('pass')
    let puts = 0
    let stored = null
    const fetchImpl = async (url, opts = {}) => {
      if (opts.method === 'PUT') {
        puts++
        if (puts < 2) return { ok: false, status: 503 }
        stored = JSON.parse(opts.body); return { ok: true, status: 200 }
      }
      return { ok: true, status: 200, json: async () => stored || {} }
    }
    const client = new SyncClient({ blobId: 'b', key, fetchImpl })
    await client.push([{ id: 'x', updatedAt: '2026' }])
    expect(puts).toBe(2)
    expect(await decryptPayload(key, stored.cipher)).toHaveLength(1)
  })
})
