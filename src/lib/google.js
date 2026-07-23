// Intelligently parse Google Maps URLs and Google share links
// (share.google/…, maps.app.goo.gl/…, goo.gl/maps/…, maps/place/…). Short links
// are resolved through a reader proxy to reveal the final URL, then the place
// name / coordinates are extracted so we can look the place up properly.

const GOOGLE_HOSTS = /(^|\.)(google\.[a-z.]+|maps\.google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl|share\.google|g\.co)$/i

/** Any Google maps/search/share URL we should treat as a place reference. */
export function isGoogleLink(url) {
  try {
    const u = new URL(url)
    if (!GOOGLE_HOSTS.test(u.hostname)) return false
    // google.com is only a place link for /maps or /search?...q=
    if (/google\.[a-z.]+$/i.test(u.hostname) && !/\/maps|\/search/.test(u.pathname + u.search) && !u.searchParams.get('q')) {
      return u.hostname.startsWith('maps.')
    }
    return true
  } catch {
    return false
  }
}

/** Short links that must be resolved (followed) before we can read the place. */
export function isShortGoogleLink(url) {
  try {
    const h = new URL(url).hostname
    return /(^|\.)(goo\.gl|maps\.app\.goo\.gl|share\.google|g\.co)$/i.test(h)
  } catch {
    return false
  }
}

const COORD = /^-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+$/

/**
 * Extract { name, lat, lng } from a Google Maps URL *or* any text that contains
 * one (e.g. a reader-proxy dump of a resolved short link). Best-effort.
 */
export function parseGooglePlace(urlOrText) {
  const s = String(urlOrText || '')
  const out = { name: null, lat: null, lng: null }

  // /maps/place/<Name>/@lat,lng
  const place = s.match(/\/maps\/place\/([^/@]+)/i)
  if (place) out.name = decodePlus(place[1])

  // @lat,lng  or  !3dLAT!4dLNG  or  ll=lat,lng
  const at = s.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)
  const bang = s.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/)
  const ll = s.match(/[?&](?:ll|sll)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/)
  const coord = bang || at || ll
  if (coord) { out.lat = Number(coord[1]); out.lng = Number(coord[2]) }

  // q= / query= / destination=  (may hold a name OR "lat,lng")
  const q = s.match(/(?:[?&]|^|\s)(?:q|query|destination)=([^&\s"'<>]+)/i)
  if (q) {
    const val = decodePlus(q[1])
    if (COORD.test(val)) {
      if (out.lat == null) { const [la, ln] = val.split(','); out.lat = Number(la); out.lng = Number(ln) }
    } else if (!out.name) {
      out.name = val
    }
  }
  if (out.name) out.name = out.name.replace(/\s+/g, ' ').trim().slice(0, 90) || null
  return out.name || out.lat != null ? out : { name: null, lat: null, lng: null }
}

/**
 * Resolve a Google link to { name, lat, lng }. Full maps URLs parse directly;
 * short links are followed via a reader proxy that reveals the final URL.
 * @param {string} url
 * @param {object} opts - { fetchImpl, timeoutMs }
 */
export async function resolveGoogle(url, opts = {}) {
  const direct = parseGooglePlace(url)
  if (direct.name || direct.lat != null) return direct
  if (!isShortGoogleLink(url)) return direct

  const fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
  if (!fetchImpl) return direct
  try {
    const res = await withTimeout(fetchImpl(`https://r.jina.ai/${url}`), opts.timeoutMs || 14000)
    const text = await res.text()
    return parseGooglePlace(text)
  } catch {
    return direct
  }
}

function decodePlus(s) {
  try {
    return decodeURIComponent(String(s).replace(/\+/g, ' '))
  } catch {
    return String(s).replace(/\+/g, ' ')
  }
}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}
