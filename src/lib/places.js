// Tokenless "Google-Maps-style" place lookup via OpenStreetMap Nominatim.
// Turns a free-text name (or lat/lng) into structured place info: coords, city,
// country, category, website, opening hours, and a short description.
//
// Pure parser (parseNominatim) is unit-tested; network is injected.

import { parseOpeningHours } from './enrich.js'

const NOMINATIM = 'https://nominatim.openstreetmap.org'

// Map OSM class/type → our wishlist categories.
const TYPE_CATEGORY = {
  restaurant: 'eat', cafe: 'eat', bar: 'eat', pub: 'eat', fast_food: 'eat', food_court: 'eat',
  ice_cream: 'eat', biergarten: 'eat', winery: 'eat', deli: 'eat', bakery: 'eat', bistro: 'eat',
  hotel: 'stay', hostel: 'stay', guest_house: 'stay', motel: 'stay', apartment: 'stay', chalet: 'stay', resort: 'stay',
  museum: 'see', gallery: 'see', artwork: 'see', attraction: 'see', viewpoint: 'see', monument: 'see',
  memorial: 'see', castle: 'see', ruins: 'see', archaeological_site: 'see', place_of_worship: 'see',
  park: 'see', garden: 'see', nature_reserve: 'see', theme_park: 'do', zoo: 'see', aquarium: 'see',
  cinema: 'do', theatre: 'do', arts_centre: 'do', nightclub: 'do', spa: 'do', water_park: 'do',
}
const CLASS_CATEGORY = { shop: 'shop', historic: 'see', tourism: 'see', leisure: 'do', natural: 'see' }

/** Map an OSM result's class/type to our category. */
export function osmCategory(cls, type) {
  if (type && TYPE_CATEGORY[type]) return TYPE_CATEGORY[type]
  if (cls && CLASS_CATEGORY[cls]) return CLASS_CATEGORY[cls]
  if (cls === 'amenity') return 'other'
  return 'other'
}

/** Parse a Nominatim jsonv2 array into a normalized partial item. */
export function parseNominatim(arr) {
  const r = Array.isArray(arr) ? arr[0] : arr
  if (!r || (r.lat == null && r.lon == null)) return null
  const a = r.address || {}
  const ex = r.extratags || {}
  const city = a.city || a.town || a.village || a.municipality || a.suburb || a.county || a.state || null
  const type = r.type || null
  const cls = r.class || r.category || null
  const out = {
    title: r.name || (r.display_name ? r.display_name.split(',')[0].trim() : null),
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lon),
    city,
    country: a.country || null,
    category: osmCategory(cls, type),
    website: cleanWeb(ex.website || ex.url || ex['contact:website']),
    source: 'lookup',
  }
  const oh = ex.opening_hours || ex['opening_hours:kitchen']
  if (oh) {
    const parsed = parseOpeningHours(oh)
    if (parsed) { out.hoursByDay = parsed.byDay; out.hours = parsed.summary }
  }
  out.snippet = describe(r, a, ex, type)
  return out
}

function describe(r, a, ex, type) {
  const bits = []
  const cuisine = ex.cuisine ? titleCase(ex.cuisine.split(';')[0].replace(/_/g, ' ')) : null
  const kind = type ? type.replace(/_/g, ' ') : null
  if (cuisine && kind) bits.push(`${cuisine} ${kind}`)
  else if (kind) bits.push(titleCase(kind))
  const where = a.road || a.neighbourhood || a.suburb || a.city || a.town
  if (where) bits.push(where)
  const s = bits.join(' · ')
  return s ? s.slice(0, 96) : null
}

/**
 * Look up a place by free-text query. Returns a normalized partial (feed to
 * normalizeItem) or a minimal object if nothing found.
 * @param {string} query
 * @param {object} opts - { fetchImpl, city, timeoutMs }
 */
export async function lookupPlace(query, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (!fetchImpl) throw new Error('no fetch available')
  const q = [query, opts.city].filter(Boolean).join(' ').trim()
  if (!q) return null
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&extratags=1&limit=1`
  const res = await withTimeout(fetchImpl(url, { headers: { Accept: 'application/json' } }), opts.timeoutMs || 12000)
  if (!res.ok) throw new Error(`nominatim HTTP ${res.status}`)
  return parseNominatim(await res.json())
}

/**
 * Autocomplete: up to `limit` place suggestions for a query. Each is a light
 * {title, city, country, lat, lng, category} shape for the dropdown.
 */
export async function nominatimSuggest(query, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (!fetchImpl) throw new Error('no fetch available')
  const q = String(query || '').trim()
  if (q.length < 2) return []
  const limit = opts.limit || 6
  const url = `${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=${limit}`
  const res = await withTimeout(fetchImpl(url, { headers: { Accept: 'application/json' } }), opts.timeoutMs || 9000)
  if (!res.ok) throw new Error(`nominatim HTTP ${res.status}`)
  const arr = await res.json()
  return (Array.isArray(arr) ? arr : []).map((r) => {
    const a = r.address || {}
    return {
      title: r.name || (r.display_name || '').split(',')[0].trim(),
      city: a.city || a.town || a.village || a.municipality || a.suburb || a.state || null,
      country: a.country || null,
      lat: numOrNull(r.lat),
      lng: numOrNull(r.lon),
      category: osmCategory(r.class || r.category, r.type),
    }
  }).filter((s) => s.title)
}

/** Reverse-geocode coordinates → normalized partial. */
export async function reverseLookup(lat, lng, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (!fetchImpl) throw new Error('no fetch available')
  const url = `${NOMINATIM}/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1&extratags=1`
  const res = await withTimeout(fetchImpl(url, { headers: { Accept: 'application/json' } }), opts.timeoutMs || 12000)
  if (!res.ok) throw new Error(`nominatim HTTP ${res.status}`)
  return parseNominatim([await res.json()])
}

// --- helpers ---
function numOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
function cleanWeb(u) {
  if (!u) return null
  const s = String(u).trim()
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}
function titleCase(s) {
  return String(s).replace(/\b\w/g, (c) => c.toUpperCase())
}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}
