// One entry point for "gather the latest info about this place". Routes by input
// shape: a Google maps/share link → resolve + place lookup; any other link →
// page enrichment; a bare name → place lookup. Returns a partial to merge.

import { enrichFromUrl } from './enrich.js'
import { lookupPlace, reverseLookup } from './places.js'
import { isGoogleLink, resolveGoogle } from './google.js'

/**
 * @param {object} ref - { url, title, city }
 * @param {object} opts - { fetchImpl, timeoutMs }
 * @returns {Promise<object|null>} partial fields to merge (or null)
 */
export async function gatherInfo(ref = {}, opts = {}) {
  const url = ref.url || null

  if (url && isGoogleLink(url)) {
    const g = await resolveGoogle(url, opts)
    let info = null
    if (g.name) info = await safe(lookupPlace(g.name, opts))
    if (!info && g.lat != null) info = await safe(reverseLookup(g.lat, g.lng, opts))
    if (!info && g.name) info = { title: g.name, source: 'lookup' }
    if (info) {
      if (info.lat == null && g.lat != null) { info.lat = g.lat; info.lng = g.lng }
      return { ...info, mapsRef: url }
    }
    return null
  }

  if (url) {
    const e = await safe(enrichFromUrl(url, opts))
    return e || null
  }

  if (ref.title) {
    return await safe(lookupPlace(ref.title, { ...opts, city: ref.city || undefined }))
  }
  return null
}

async function safe(p) {
  try {
    return await p
  } catch {
    return null
  }
}
