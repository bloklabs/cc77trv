// Turn a paste of *many* places — a bulleted list, a whole email, a comma list,
// a stack of links — into separate candidate entries. Pure + deterministic so
// it is fully unit-tested. Each candidate: { title, url, city, note }.
//
// It also understands city headers ("London:", "For Paris") so an email grouped
// by city assigns the right city to the items beneath each heading.

import { resolveCity } from './geo.js'

const BULLET = /^\s*(?:[-*•·▪◦‣~»>]+|\d+\s*[.)]|\(\d+\))\s+/
const URL_RE = /https?:\/\/[^\s)>\]]+/i

// Lines that are clearly email chrome / filler, never a place (only applied to
// url-less, bullet-less lines so we never drop a real entry that has a link).
const NOISE = /^(hi|hey|hello|dear|thanks|thank you|thx|thankyou|best|cheers|regards|warmly|sincerely|xoxo+|talk soon|ttyl|p\.?s\.?|sent from my|here('|’)?s|here are|here is|below (are|is)|attached|these are|let me know|lmk|wanted to (share|send)|a few (ideas|places|spots)|some (ideas|options|places|spots|recs|recommendations)|my (list|wishlist)|wish\s?list|the list|to try|to go|places to|want to go|things to do|ideas|options|fyi|enjoy|have fun|love you|miss you)\b/i

/** @returns {Array<{title:string|null,url:string|null,city:string|null,note:string|null}>} */
export function parseBulk(input) {
  const text = String(input || '')
  const lines = text.split(/\r?\n/)
  const out = []
  let currentCity = null

  for (const rawLine of lines) {
    let line = rawLine.trim()
    if (!line) continue
    const wasBullet = BULLET.test(line)
    line = line.replace(BULLET, '').trim()
    if (!line) continue

    const um = line.match(URL_RE)
    const url = um ? um[0].replace(/[.,;]+$/, '') : null
    let textPart = (url ? line.replace(um[0], '') : line).replace(/[|–—:>\-\s]+$/, '').trim()

    // parenthetical or trailing "- note" becomes a note, not part of the name
    let note = null
    const pm = textPart.match(/[（(]([^)）]{1,80})[)）]\s*$/)
    if (pm) { note = pm[1].trim(); textPart = textPart.slice(0, pm.index).trim() }

    if (!url && !wasBullet) {
      const header = cityHeader(textPart)
      if (header) { currentCity = header; continue }
      if (NOISE.test(textPart)) continue
    }

    // split single lines that are actually comma / "and" lists of places
    const segments = !url ? splitList(textPart) : [textPart]
    for (const seg of segments) {
      const title = tidyName(seg)
      if (!title && !url) continue
      out.push({ title: title || null, url, city: currentCity, note })
    }
  }
  return out
}

/** True when the whole input describes more than one place. */
export function isBulk(input) {
  const text = String(input || '')
  if (/\r?\n/.test(text.trim())) return parseBulk(text).length > 1
  return parseBulk(text).length > 1
}

/** A line that is purely a city name / "For Paris" heading → canonical city. */
export function cityHeader(text) {
  let t = String(text || '').trim().replace(/^(for|in|—|-)\s+/i, '').replace(/[:\-–—•\s]+$/, '')
  t = t.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim()
  if (!t || t.split(/\s+/).length > 3) return null
  const r = resolveCity(t)
  if (!r) return null
  // the line must essentially BE the city (not "dinner near Tokyo")
  const lt = t.toLowerCase()
  const ln = r.name.toLowerCase()
  return lt === ln || lt.includes(ln) || ln.includes(lt) ? r.name : null
}

function splitList(text) {
  const t = String(text || '')
  if (!/[,、;]| and /i.test(t)) return [t]
  const parts = t.split(/\s*(?:,|、|;|\sand\s)\s*/i).map((s) => s.trim()).filter(Boolean)
  // only treat as a list if every part looks like a short name (not prose)
  if (parts.length >= 2 && parts.every((p) => p.length >= 2 && p.length <= 42 && p.split(/\s+/).length <= 6)) {
    return parts
  }
  return [t]
}

function tidyName(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.,;–—\-\s]+$/, '')
    .trim()
    .slice(0, 90)
}
