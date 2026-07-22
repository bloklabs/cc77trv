// Turn messy input (a pasted URL, a title, scraped metadata) into a normalized
// wishlist item with consistent fields the rest of the app relies on.

import { resolveCity } from './geo.js'

export const CATEGORIES = ['eat', 'stay', 'see', 'do', 'shop', 'other']

export const CATEGORY_META = {
  eat: { label: 'Eat', emoji: '🍜', color: '#ef4444', defaultVisitMin: 90 },
  stay: { label: 'Stay', emoji: '🏨', color: '#8b5cf6', defaultVisitMin: 0 },
  see: { label: 'See', emoji: '🏛️', color: '#0ea5e9', defaultVisitMin: 75 },
  do: { label: 'Do', emoji: '🎟️', color: '#f59e0b', defaultVisitMin: 120 },
  shop: { label: 'Shop', emoji: '🛍️', color: '#ec4899', defaultVisitMin: 45 },
  other: { label: 'Other', emoji: '📍', color: '#64748b', defaultVisitMin: 60 },
}

const CATEGORY_HINTS = {
  eat: ['restaurant', 'ramen', 'sushi', 'cafe', 'coffee', 'bar', 'izakaya', 'bakery', 'dinner', 'lunch', 'brunch', 'eat', 'food', 'michelin', 'omakase', 'bistro', 'tavern', 'brewery', 'winery', 'dining'],
  stay: ['hotel', 'ryokan', 'hostel', 'resort', 'airbnb', 'stay', 'inn', 'guesthouse', 'lodge', 'booking.com', 'agoda', 'hotels.com', 'suite', 'onsen hotel'],
  see: ['museum', 'temple', 'shrine', 'castle', 'palace', 'cathedral', 'gallery', 'landmark', 'viewpoint', 'garden', 'park', 'monument', 'ruins', 'see'],
  do: ['tour', 'class', 'experience', 'ticket', 'activity', 'hike', 'cruise', 'show', 'onsen', 'spa', 'diving', 'snorkel', 'workshop', 'tasting', 'getyourguide', 'viator'],
  shop: ['shop', 'store', 'market', 'boutique', 'mall', 'outlet', 'vintage', 'flea'],
}

const CURRENCY = { '$': 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₩': 'KRW', '฿': 'THB' }
// Rough FX to USD — for budgeting bands only, not accounting.
const FX_TO_USD = { USD: 1, GBP: 1.27, EUR: 1.08, JPY: 0.0067, KRW: 0.00073, THB: 0.028, CNY: 0.14 }

/**
 * @param {object} raw - { url, title, description, image, category, city, lat, lng, costRaw, notes, tags }
 * @returns {object} normalized item (without id/timestamps — the store assigns those)
 */
export function normalizeItem(raw = {}) {
  const url = cleanUrl(raw.url)
  const title = (raw.title || deriveTitleFromUrl(url) || 'Untitled place').trim()
  const haystack = [title, raw.description, url, (raw.tags || []).join(' ')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const category = CATEGORIES.includes(raw.category) ? raw.category : detectCategory(haystack)
  const cityGuess = raw.city || guessCityFromText(haystack)
  const resolved = cityGuess ? resolveCity(cityGuess) : null

  const cost = parseCost(raw.costRaw ?? raw.description ?? '')
  const reservation = detectReservation(haystack, category)

  return {
    url: url || null,
    title,
    description: (raw.description || '').trim() || null,
    image: raw.image || null,
    category,
    city: resolved ? resolved.name : (cityGuess ? titleTrim(cityGuess) : null),
    country: resolved ? resolved.country : (raw.country || null),
    region: resolved ? resolved.region : null,
    lat: numOrNull(raw.lat) ?? (resolved ? resolved.lat : null),
    lng: numOrNull(raw.lng) ?? (resolved ? resolved.lng : null),
    costUsd: raw.costUsd != null ? numOrNull(raw.costUsd) : cost.usd,
    costRaw: cost.raw || (raw.costRaw || null),
    currency: cost.currency,
    reservation,
    visitMin: numOrNull(raw.visitMin) ?? CATEGORY_META[category].defaultVisitMin,
    tags: dedupe((raw.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)),
    notes: (raw.notes || '').trim() || null,
    source: raw.source || 'manual',
  }
}

export function detectCategory(text) {
  const t = (text || '').toLowerCase()
  let best = 'other'
  let bestScore = 0
  for (const cat of Object.keys(CATEGORY_HINTS)) {
    const score = CATEGORY_HINTS[cat].reduce((n, kw) => (t.includes(kw) ? n + 1 : n), 0)
    if (score > bestScore) {
      bestScore = score
      best = cat
    }
  }
  return best
}

export function parseCost(text) {
  const s = String(text || '')
  // e.g. "$120", "¥8,000", "€45 per person", "USD 200"
  const sym = s.match(/([$£€¥₩฿])\s?([\d.,]+)/)
  const code = s.match(/\b(USD|GBP|EUR|JPY|KRW|THB|CNY)\b\s?([\d.,]+)/i)
  let currency = null
  let amount = null
  if (sym) {
    currency = CURRENCY[sym[1]]
    amount = toNumber(sym[2])
  } else if (code) {
    currency = code[1].toUpperCase()
    amount = toNumber(code[2])
  }
  if (amount == null) return { usd: null, currency: null, raw: null }
  const fx = FX_TO_USD[currency] ?? 1
  return {
    usd: Math.round(amount * fx * 100) / 100,
    currency,
    raw: (sym ? sym[0] : code[0]).trim(),
  }
}

export function detectReservation(text, category) {
  const t = (text || '').toLowerCase()
  const strong = ['reservation required', 'book in advance', 'advance booking', 'tickets required', 'reserve ahead', 'timed entry', 'sold out', 'omakase', 'michelin']
  const weak = ['reservation', 'booking', 'reserve', 'tickets', 'sold out', 'waitlist']
  if (strong.some((k) => t.includes(k))) {
    return { required: true, leadDays: t.includes('omakase') || t.includes('michelin') ? 30 : 14, note: 'Advance reservation strongly recommended' }
  }
  if (weak.some((k) => t.includes(k)) || category === 'stay') {
    return { required: category === 'stay', leadDays: category === 'stay' ? 21 : 3, note: category === 'stay' ? 'Book lodging early' : 'May need a reservation' }
  }
  return { required: false, leadDays: 0, note: null }
}

// --- helpers ---

export function cleanUrl(url) {
  if (!url || typeof url !== 'string') return null
  let u = url.trim()
  if (!u) return null
  if (!/^https?:\/\//i.test(u)) {
    if (/^[\w-]+(\.[\w-]+)+/.test(u)) u = 'https://' + u
    else return null
  }
  try {
    const parsed = new URL(u)
    // strip common tracking params
    ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((p) => parsed.searchParams.delete(p))
    return parsed.toString()
  } catch {
    return null
  }
}

export function deriveTitleFromUrl(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (last) return titleTrim(decodeURIComponent(last).replace(/[-_]+/g, ' ').replace(/\.\w+$/, '')).replace(/\b\w/g, (c) => c.toUpperCase())
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

function guessCityFromText(text) {
  const r = resolveCity(text)
  return r ? r.name : null
}

function titleTrim(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 80)
}

function toNumber(s) {
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function numOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function dedupe(arr) {
  return [...new Set(arr)]
}
