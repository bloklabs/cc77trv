// Autonomous enrichment: given a URL, fetch the page (through a no-auth reader
// proxy so it works from a static site) and extract structured metadata —
// title, description, image, price, and geo — to pre-fill a wishlist item.
//
// The HTML parser is regex-based and pure so it runs in Node tests without a
// DOM. Network fetching is injected so tests never touch the network.

/** Extract OpenGraph / <title> / meta-description / JSON-LD from raw HTML. */
export function parseHtmlMetadata(html) {
  const out = { title: null, description: null, image: null, costRaw: null, lat: null, lng: null, city: null }
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
  }

  // Bare price fallback from visible text if JSON-LD had none.
  if (out.costRaw == null) {
    const m = html.match(/[$£€¥]\s?\d[\d.,]{0,7}/)
    if (m) out.costRaw = m[0].trim()
  }
  return out
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

  let lastErr = null
  for (const proxy of proxies) {
    try {
      const body = await withTimeout(fetchImpl(proxy.build(url)).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.text()
      }), timeoutMs)
      if (!body) continue
      const meta = proxy.kind === 'html' ? parseHtmlMetadata(body) : parseTextMetadata(body)
      if (meta.title || meta.description) {
        return { url, source: 'enriched', enrichedVia: proxy.name, ...stripNull(meta) }
      }
    } catch (e) {
      lastErr = e
    }
  }
  // Nothing worked — return the URL so the item is still saveable.
  return { url, source: 'manual', enrichError: lastErr ? String(lastErr.message || lastErr) : 'no metadata' }
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
