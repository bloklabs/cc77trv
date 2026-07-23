// Turn messy input (a pasted URL, a title, scraped metadata) into a normalized
// wishlist item with consistent fields the rest of the app relies on.

import { resolveCity } from './geo.js'

export const CATEGORIES = ['eat', 'stay', 'see', 'do', 'shop', 'other']

export const CATEGORY_META = {
  eat: { label: 'Eat', emoji: '🍜', color: '#d79b86', defaultVisitMin: 90 },   // soft persimmon
  stay: { label: 'Stay', emoji: '🏨', color: '#a89bc4', defaultVisitMin: 0 },  // wisteria
  see: { label: 'See', emoji: '🏛️', color: '#8296b4', defaultVisitMin: 75 },   // soft indigo
  do: { label: 'Do', emoji: '🎟️', color: '#cbb07d', defaultVisitMin: 120 },   // soft gold
  shop: { label: 'Shop', emoji: '🛍️', color: '#d3a0ad', defaultVisitMin: 45 }, // sakura
  other: { label: 'Other', emoji: '📍', color: '#9db091', defaultVisitMin: 60 }, // soft sage
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
  const haystack = [title, raw.description, raw.snippet, raw.notes, url, (raw.tags || []).join(' ')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const category = CATEGORIES.includes(raw.category) ? raw.category : detectCategory(haystack)
  const cityGuess = raw.city || guessCityFromText(haystack)
  const resolved = cityGuess ? resolveCity(cityGuess) : null

  const cost = parseCost(raw.costRaw ?? raw.description ?? '')
  const reservation = detectReservation(haystack, category)
  const cityName = resolved ? resolved.name : (cityGuess ? titleTrim(cityGuess) : null)
  const booking = bookingDifficulty({ title, category, text: haystack, reservation, override: raw.access })

  return {
    url: url || null,
    mapsUrl: raw.mapsUrl || buildMapsUrl(title, cityName),
    title,
    description: (raw.description || '').trim() || null,
    image: raw.image || null,
    category,
    city: cityName,
    country: resolved ? resolved.country : (raw.country || null),
    region: resolved ? resolved.region : null,
    lat: numOrNull(raw.lat) ?? (resolved ? resolved.lat : null),
    lng: numOrNull(raw.lng) ?? (resolved ? resolved.lng : null),
    costUsd: raw.costUsd != null ? numOrNull(raw.costUsd) : cost.usd,
    costRaw: cost.raw || (raw.costRaw || null),
    currency: cost.currency,
    reservation,
    booking,
    access: ACCESS_TIERS.includes(raw.access) ? raw.access : null, // explicit override, if any
    visitMin: numOrNull(raw.visitMin) ?? CATEGORY_META[category].defaultVisitMin,
    hours: (raw.hours || '').toString().trim() || null,
    hoursByDay: raw.hoursByDay && typeof raw.hoursByDay === 'object' ? raw.hoursByDay : null,
    snippet: makeSnippet(raw.snippet || raw.description),
    website: cleanUrl(raw.website) || null,
    tags: dedupe((raw.tags || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)),
    notes: (raw.notes || '').trim() || null,
    source: raw.source || 'manual',
    gatheredAt: raw.gatheredAt || null,
    gatherVersion: numOrNull(raw.gatherVersion) ?? 0,
  }
}

/** A very short one-line snippet from free text. */
export function makeSnippet(text, max = 96) {
  if (!text) return null
  const s = String(text).replace(/\s+/g, ' ').trim()
  if (!s) return null
  if (s.length <= max) return s
  return s.slice(0, max - 1).replace(/[\s,.;:–-]+\S*$/, '') + '…'
}

/**
 * Given an item's hoursByDay map, return today's hours string (local day),
 * or null. Kept here so both UI and blurbs can surface "latest" hours.
 */
export function todaysHours(item, dayIdx) {
  if (!item || !item.hoursByDay) return null
  const d = dayIdx == null ? new Date().getDay() : dayIdx
  return item.hoursByDay[d] || item.hoursByDay[String(d)] || null
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
  const strong = ['reservation required', 'book well ahead', 'book far ahead', 'book a month', 'months in advance', 'tickets required', 'timed entry', 'omakase', 'michelin', 'impossible to book', 'concierge']
  const weak = ['reservation', 'booking', 'reserve', 'book ahead', 'reserve ahead', 'tickets', 'sold out', 'waitlist']
  if (strong.some((k) => t.includes(k))) {
    return { required: true, leadDays: t.includes('omakase') || t.includes('michelin') ? 30 : 14, note: 'Advance reservation strongly recommended' }
  }
  if (weak.some((k) => t.includes(k)) || category === 'stay') {
    return { required: category === 'stay', leadDays: category === 'stay' ? 21 : 3, note: category === 'stay' ? 'Book lodging early' : 'May need a reservation' }
  }
  return { required: false, leadDays: 0, note: null }
}

export const BOOKING_LABELS = {
  1: 'Walk-in',
  2: 'Easy',
  3: 'Book ahead',
  4: 'Hard — weeks out',
  5: 'Very hard — a month+',
}

// The "how do I get in?" tier the user actually cares about.
export const ACCESS_TIERS = ['walkin', 'reservation', 'concierge']
export const ACCESS_META = {
  walkin: { tier: 'walkin', label: 'Walk-in', hint: 'Just show up', emoji: '🚶' },
  reservation: { tier: 'reservation', label: 'Reservation', hint: 'Book a table ahead', emoji: '📅' },
  concierge: { tier: 'concierge', label: 'Concierge', hint: 'Needs advance / concierge help', emoji: '🎩' },
}

// Notoriously hard tables / must-plan spots — matched by name substring.
const HARD_TO_BOOK = {
  ambroisie: 5, arpege: 5, 'arpège': 5, plenitude: 5, 'plénitude': 5, taillevent: 5,
  septime: 5, doyenne: 5, 'doyenné': 5, 'le doyenne': 5, "l'ambroisie": 5,
  'cheval blanc': 5, 'guy savoy': 5, 'kei ': 5, 'le clarence': 5, 'table du connaisseur': 5,
  'noma': 5, 'the ledbury': 5, sketch: 4, 'core by clare': 5, 'ikoyi': 4,
  dorian: 4, 'noble rot': 4, 'quality wines': 4, 'brat': 4, 'lyle': 4, 'st john': 3,
  'brunswick house': 3, 'le bon georges': 4, parcelles: 4, 'petit sommelier': 3, 'clamato': 4,
}

function tierFromScore(score) {
  if (score >= 5) return 'concierge'
  if (score >= 3) return 'reservation'
  return 'walkin'
}

/**
 * Auto-rate how hard something is to get into. Returns a 1–5 score AND the
 * access tier the user asked for: walkin | reservation | concierge.
 * An explicit `override` (one of ACCESS_TIERS) wins over the heuristic.
 * @returns {{score:number,label:string,tier:string,tierLabel:string,tierHint:string,reason:string|null}}
 */
export function bookingDifficulty({ title, category, text, reservation, override } = {}) {
  const hay = `${title || ''} ${text || ''}`.toLowerCase()
  let score = { eat: 2, stay: 2, do: 2, see: 1, shop: 1, other: 1 }[category] || 1
  const reasons = []

  for (const [name, s] of Object.entries(HARD_TO_BOOK)) {
    if (hay.includes(name)) { score = Math.max(score, s); reasons.push('in-demand spot'); break }
  }
  if (/michelin|three[- ]star|3[- ]star|two[- ]star|\bstarred\b|tasting menu|omakase|chef'?s table|fine dining/.test(hay)) {
    score += 1; reasons.push('fine dining')
  }
  if (reservation) {
    if (reservation.required) { score += 1; reasons.push('reservation required') }
    if ((reservation.leadDays || 0) >= 30) score += 1
    else if ((reservation.leadDays || 0) >= 14) score += 0.5
  }
  if (/walk[- ]?in|no (?:reservations?|booking)|first come|counter service|takeaway|to-go|espresso bar|coffee (bar|stand)/.test(hay)) {
    score = Math.min(score, 2); reasons.push('walk-in')
  }

  score = Math.max(1, Math.min(5, Math.round(score)))
  let tier = tierFromScore(score)
  if (ACCESS_TIERS.includes(override)) {
    tier = override
    score = override === 'concierge' ? 5 : override === 'reservation' ? 3 : 1
    reasons.unshift('set by you')
  }
  const meta = ACCESS_META[tier]
  return { score, label: BOOKING_LABELS[score], tier, tierLabel: meta.label, tierHint: meta.hint, reason: reasons[0] || null }
}

/** Always-valid Google Maps search link for a place. */
export function buildMapsUrl(title, city) {
  const q = [title, city].filter(Boolean).join(' ').trim()
  if (!q) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
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
