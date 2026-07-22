// Autonomous enrichment: given a URL, fetch the page (through a no-auth reader
// proxy so it works from a static site) and extract structured metadata —
// title, description, image, price, and geo — to pre-fill a wishlist item.
//
// The HTML parser is regex-based and pure so it runs in Node tests without a
// DOM. Network fetching is injected so tests never touch the network.

/** Extract OpenGraph / <title> / meta-description / JSON-LD from raw HTML. */
export function parseHtmlMetadata(html) {
  const out = { title: null, description: null, image: null, costRaw: null, lat: null, lng: null, city: null, hours: null, hoursByDay: null, snippet: null }
  if (!html || typeof html !== 'string') return out

  const meta = (prop) => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`,
      'i'
    )
    const alt = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`,
      'i'
    )
    const m = html.match(re) || html.match(alt)
    return m ? decodeEntities(m[1].trim()) : null
  }

  out.title = meta('og:title') || meta('twitter:title') || titleTag(html)
  out.description = meta('og:description') || meta('twitter:description') || meta('description')
  out.image = meta('og:image') || meta('twitter:image')

  const ldItems = parseJsonLd(html)
  for (const it of ldItems) {
    const geo = it.geo || (it.location && it.location.geo)
    if (geo && out.lat == null) {
      out.lat = numOrNull(geo.latitude)
      out.lng = numOrNull(geo.longitude)
    }
    const offers = it.offers
    if (offers && out.costRaw == null) {
      const price = Array.isArray(offers) ? offers[0] : offers
      const amt = price && (price.price || price.lowPrice)
      const cur = price && price.priceCurrency
      if (amt) out.costRaw = `${currencySymbol(cur)}${amt}`
    }
    const addr = it.address || (it.location && it.location.address)
    if (addr && out.city == null) {
      out.city = addr.addressLocality || addr.addressRegion || null
    }
    if (!out.title && it.name) out.title = String(it.name)
    const oh = it.openingHoursSpecification || it.openingHours || (it.location && it.location.openingHoursSpecification)
    if (oh && !out.hoursByDay) {
      const parsed = parseOpeningHours(oh)
      if (parsed) { out.hoursByDay = parsed.byDay; out.hours = parsed.summary }
    }
  }

  // Bare price fallback from visible text if JSON-LD had none.
  if (out.costRaw == null) {
    const m = html.match(/[$£€¥]\s?\d[\d.,]{0,7}/)
    if (m) out.costRaw = m[0].trim()
  }
  out.snippet = makeSnippet(out.description)
  return out
}

const DAY_IDX = {
  sunday: 0, sun: 0, su: 0, monday: 1, mon: 1, mo: 1, tuesday: 2, tue: 2, tu: 2,
  wednesday: 3, wed: 3, we: 3, thursday: 4, thu: 4, th: 4, friday: 5, fri: 5, fr: 5,
  saturday: 6, sat: 6, sa: 6,
}
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Normalize schema.org opening hours (spec objects OR "Mo-Fr 09:00-17:00"
 * strings) into { byDay: {0..6: "09:00–17:00"}, summary: "Mon–Sun 11:00–22:00" }.
 */
export function parseOpeningHours(oh) {
  const byDay = {}
  const specs = Array.isArray(oh) ? oh : [oh]
  for (const spec of specs) {
    if (spec && typeof spec === 'object' && (spec.opens || spec.closes || spec.dayOfWeek)) {
      const days = [].concat(spec.dayOfWeek || []).map(dayName).filter((d) => d != null)
      const range = fmtRange(spec.opens, spec.closes)
      for (const d of days) if (range) byDay[d] = range
    } else if (typeof spec === 'string') {
      // "Mo-Fr 09:00-17:00", "Sa 10:00-14:00", possibly comma-separated
      for (const part of spec.split(/[,;]/)) {
        const m = part.trim().match(/^([A-Za-z]{2,3})(?:\s*[-–]\s*([A-Za-z]{2,3}))?\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/)
        if (!m) continue
        const start = dayName(m[1])
        const end = m[2] ? dayName(m[2]) : start
        const range = fmtRange(m[3], m[4])
        if (start == null || !range) continue
        for (let d = start; ; d = (d + 1) % 7) {
          byDay[d] = range
          if (d === end) break
        }
      }
    }
  }
  if (!Object.keys(byDay).length) return null
  return { byDay, summary: summarize(byDay) }
}

function dayName(v) {
  if (v == null) return null
  const s = String(v).toLowerCase().replace(/^https?:\/\/schema\.org\//, '').trim()
  return DAY_IDX[s] != null ? DAY_IDX[s] : null
}
function fmtRange(opens, closes) {
  const o = trimTime(opens)
  const c = trimTime(closes)
  if (!o && !c) return null
  if (o === '00:00' && (c === '23:59' || c === '00:00')) return 'Open 24h'
  return `${o || '?'}–${c || '?'}`
}
function trimTime(t) {
  if (!t) return null
  const m = String(t).match(/(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}
function summarize(byDay) {
  // Collapse consecutive days sharing the same range into "Mon–Fri 9–5".
  const parts = []
  let run = null
  for (let d = 1; d <= 7; d++) {
    const idx = d % 7 // Mon..Sun order for readability
    const r = byDay[idx]
    if (r && run && run.range === r && run.end === (idx + 6) % 7) {
      run.end = idx
    } else {
      if (run) parts.push(runLabel(run))
      run = r ? { start: idx, end: idx, range: r } : null
    }
  }
  if (run) parts.push(runLabel(run))
  return parts.join(', ')
}
function runLabel(run) {
  const days = run.start === run.end ? DAY_ABBR[run.start] : `${DAY_ABBR[run.start]}–${DAY_ABBR[run.end]}`
  return `${days} ${run.range}`
}

/** A very short one-line snippet from a description. */
export function makeSnippet(desc, max = 96) {
  if (!desc) return null
  const s = String(desc).replace(/\s+/g, ' ').trim()
  if (s.length <= max) return s
  return s.slice(0, max - 1).replace(/[\s,.;:–-]+\S*$/, '') + '…'
}

function parseJsonLd(html) {
  const items = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1].trim())
      const arr = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data]
      for (const node of arr) if (node && typeof node === 'object') items.push(node)
    } catch {
      /* ignore malformed blocks */
    }
  }
  return items
}

/** Reader proxies that expose CORS-friendly access to arbitrary pages. */
export const PROXIES = [
  { name: 'allorigins', kind: 'html', build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { name: 'jina', kind: 'text', build: (u) => `https://r.jina.ai/${u}` },
]

/**
 * Fetch + enrich a URL. Returns a partial raw item (feed to normalizeItem).
 * @param {string} url
 * @param {object} opts - { fetchImpl, timeoutMs, proxies }
 */
export async function enrichFromUrl(url, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null)
  if (!fetchImpl) throw new Error('no fetch available')
  const proxies = opts.proxies || PROXIES
  const timeoutMs = opts.timeoutMs || 12000

  const fromUrl = deriveFromUrl(url) // instagram handle / hostname fallback

  let lastErr = null
  for (const proxy of proxies) {
    try {
      const body = await withTimeout(fetchImpl(proxy.build(url)).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      }), timeoutMs)
      if (!body) continue
      const meta = proxy.kind === 'html' ? parseHtmlMetadata(body) : parseTextMetadata(body)
      meta.title = cleanTitle(meta.title)
      // Instagram (and other login-walled pages) often only yield a junk title.
      if (!meta.title || /^instagram|^log in|^login|^page not found/i.test(meta.title)) {
        meta.title = fromUrl.title || meta.title
      }
      if (meta.title || meta.description) {
        return { url, source: 'enriched', enrichedVia: proxy.name, ...stripNull(meta) }
      }
    } catch (e) {
      lastErr = e
    }
  }
  // Nothing worked — still return a usable name derived from the URL itself.
  return { url, title: fromUrl.title, source: 'manual', enrichError: lastErr ? String(lastErr.message || lastErr) : 'no metadata' }
}

/** Best-effort name from a URL alone (used when fetching fails or is blocked). */
export function deriveFromUrl(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (/(^|\.)instagram\.com$/.test(host)) {
      const parts = u.pathname.split('/').filter(Boolean)
      // /<handle>/ → profile; /p/<id>, /reel/<id> → no handle available
      if (parts[0] && !['p', 'reel', 'reels', 'tv', 'explore', 'stories'].includes(parts[0])) {
        return { title: humanizeHandle(parts[0]), handle: parts[0] }
      }
      return { title: 'Instagram find', handle: null }
    }
    if (/(^|\.)(maps\.google|goo\.gl|maps\.app\.goo\.gl)/.test(host)) {
      const q = u.searchParams.get('q') || u.searchParams.get('query')
      if (q) return { title: decodeURIComponent(q).replace(/\+/g, ' ') }
    }
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (last && !/^\d+$/.test(last)) {
      return { title: decodeURIComponent(last).replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').replace(/\b\w/g, (c) => c.toUpperCase()) }
    }
    return { title: host }
  } catch {
    return { title: null }
  }
}

function humanizeHandle(h) {
  return h.replace(/^@/, '').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Strip common site/social suffixes from a scraped title. */
export function cleanTitle(t) {
  if (!t) return t
  return String(t)
    .replace(/\s*[•|·]\s*Instagram.*$/i, '')
    .replace(/\s+on Instagram.*$/i, '')
    .replace(/\s*\(@[^)]+\)\s*/g, ' ')
    .replace(/\s*[-–|]\s*(Google Maps|Official Site|Home|Menu|Booking|Reservations?)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || null
}

/** Extract a title/description from a plain-text reader dump (jina). */
export function parseTextMetadata(text) {
  const out = { title: null, description: null, image: null, costRaw: null }
  if (!text) return out
  const titleLine = text.match(/^Title:\s*(.+)$/im)
  if (titleLine) out.title = titleLine[1].trim()
  const clean = text.replace(/^Title:.*$/im, '').replace(/^URL Source:.*$/im, '').trim()
  const firstPara = clean.split(/\n{2,}/).map((s) => s.trim()).find((s) => s.length > 40)
  if (firstPara) out.description = firstPara.slice(0, 300)
  const price = text.match(/[$£€¥]\s?\d[\d.,]{0,7}/)
  if (price) out.costRaw = price[0].trim()
  return out
}

// --- helpers ---
function titleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return m ? decodeEntities(m[1].trim()) : null
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
}

function currencySymbol(code) {
  return { USD: '$', GBP: '£', EUR: '€', JPY: '¥', KRW: '₩', THB: '฿' }[code] || (code ? code + ' ' : '$')
}

function numOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function stripNull(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) if (v != null) out[k] = v
  return out
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}
