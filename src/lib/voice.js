// The paid journey runs on authenticated OS3. This module exchanges only
// bounded, untrusted text through fragments; no browser API credentials.
export const VOICE_KEY = 'os3-concierge.voice.v1'
export const VOICE_MAX_BYTES = 8192
export const VOICE_TTL_MS = 24 * 60 * 60 * 1000
export const OS3_ORIGINS = ['https://os.unitary.com', 'https://staging.os.unitary.com']
// Voice first ships through OS3's reviewed staging release. Promote this
// default only after the production voice route is deployed and verified.
export const VOICE_DEFAULT_ORIGIN = 'https://staging.os.unitary.com'
export const CONCIERGE_RETURN = 'https://bloklabs.github.io/os3-concierge/'
export const VOICE_LOCALES = [
  ['es-ES', 'Spanish · Spain'], ['eu-ES', 'Basque'], ['ca-ES', 'Catalan'],
  ['gl-ES', 'Galician'], ['fr-FR', 'French'], ['it-IT', 'Italian'],
  ['pt-PT', 'Portuguese · Portugal'], ['de-DE', 'German'],
  ['en-GB', 'English · UK'], ['en-US', 'English · US'], ['ja-JP', 'Japanese'],
]
const states = ['preparing', 'dialing', 'connected', 'needs_information', 'cancel_requested', 'completed', 'failed', 'canceled', 'outcome_unknown']
const noncePattern = /^[A-Za-z0-9_-]{16,64}$/
const bytes = (s) => new TextEncoder().encode(s)
const object = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)

function text(value, limit, label, required = true) {
  if (value == null && !required) return ''
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) {
    throw new Error(`Check ${label}.`)
  }
  return value.trim()
}

function member(value, values, label) {
  if (!values.includes(value)) throw new Error(`Unsupported ${label}.`)
  return value
}

export function os3Origin(value = VOICE_DEFAULT_ORIGIN) {
  if (!OS3_ORIGINS.includes(value)) throw new Error('Voice must open on an approved OS3 site.')
  return value
}

export function encodeVoice(value) {
  const encoded = bytes(JSON.stringify(value))
  if (encoded.length > VOICE_MAX_BYTES) throw new Error('Voice handoff is too large. Shorten the text.')
  return btoa(String.fromCharCode(...encoded)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function decodeVoice(input) {
  if (typeof input !== 'string' || input.length > Math.ceil(VOICE_MAX_BYTES * 4 / 3)) {
    throw new Error('Voice handoff is too large.')
  }
  let raw = input.trim()
  if (!raw.startsWith('{')) {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('Voice handoff could not be read.')
    try {
      const binary = atob(raw.replaceAll('-', '+').replaceAll('_', '/'))
      raw = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
    } catch { throw new Error('Voice handoff could not be read.') }
  }
  if (bytes(raw).length > VOICE_MAX_BYTES) throw new Error('Voice handoff is too large.')
  try {
    const value = JSON.parse(raw)
    if (!object(value)) throw new Error()
    return value
  } catch { throw new Error('Voice handoff could not be read.') }
}

export function buildVoicePrefill(draft, { nonce, origin = VOICE_DEFAULT_ORIGIN } = {}) {
  os3Origin(origin)
  if (!noncePattern.test(nonce || '')) throw new Error('A secure voice request could not be created.')
  const value = {
    v: 1, mode: member(draft.mode, ['speak', 'call'], 'voice mode'),
    instruction: text(draft.instruction, 2000, 'English instruction'),
    locale: member(draft.locale, VOICE_LOCALES.map(([tag]) => tag), 'language'),
    ref: text(draft.ref || 'voice', 128, 'place reference'),
    nonce, return: CONCIERGE_RETURN,
  }
  const name = text(draft.restaurantName, 200, 'restaurant name', false)
  const city = text(draft.city, 120, 'city', false)
  const phone = text(draft.phone, 32, 'phone number', false)
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error('Use an international phone number, for example +34943293763.')
  if (name || city || phone) value.restaurant = { name, city, phone }
  const url = `${origin}/#voice=${encodeVoice(value)}`
  return { value, url }
}

export function readVoice(storage) {
  const raw = storage.getItem(VOICE_KEY)
  if (!raw) return { v: 1, draft: {}, pending: [], results: [] }
  try {
    const value = JSON.parse(raw)
    if (value.v !== 1 || !object(value.draft) || !Array.isArray(value.pending) || !Array.isArray(value.results)) throw new Error()
    return value
  } catch { throw new Error('Saved voice data could not be read. It has been kept on this device.') }
}

function writeVoice(storage, value) {
  try { storage.setItem(VOICE_KEY, JSON.stringify(value)) }
  catch { throw new Error('Could not save on this device. Free some storage and try again; your previous voice data is kept.') }
}

function lockedWrite(action) {
  const locks = globalThis.navigator?.locks
  if (!locks?.request) throw new Error('Voice needs a secure browser with cross-tab storage locking. Open the HTTPS Concierge app; saved text remains readable.')
  return locks.request(VOICE_KEY, { mode: 'exclusive' }, async () => action())
}

export async function saveVoiceDraft(storage, draft) {
  return lockedWrite(() => {
    const value = readVoice(storage)
    writeVoice(storage, { ...value, draft: { ...draft } })
  })
}

export async function beginVoice(storage, draft, { origin, nonce = globalThis.crypto.randomUUID(), now = Date.now() } = {}) {
  return lockedWrite(() => {
    const handoff = buildVoicePrefill(draft, { origin, nonce })
    const value = readVoice(storage)
    const pending = value.pending.filter((p) => p.expiresAt > now)
    if (pending.some((p) => p.nonce === nonce) || value.results.some((p) => p.nonce === nonce)) throw new Error('Voice request already exists.')
    if (pending.length >= 100) throw new Error('Too many outstanding voice requests. Finish a request before starting another.')
    pending.push({ nonce, ref: handoff.value.ref, mode: handoff.value.mode, label: handoff.value.restaurant?.name || '', origin: os3Origin(origin), createdAt: now, expiresAt: now + VOICE_TTL_MS })
    // One storage write persists the nonce before navigation. Storage failure
    // prevents launch instead of losing the only way to validate the return.
    writeVoice(storage, { ...value, draft: { ...draft }, pending })
    return handoff.url
  })
}

export function validateVoiceResult(value) {
  if (!object(value) || value.v !== 1 || value.source !== 'os3-voice' || !noncePattern.test(value.nonce || '')) throw new Error('This is not a valid OS3 voice result.')
  const result = {
    v: 1, source: 'os3-voice', nonce: value.nonce,
    ref: text(value.ref, 128, 'place reference'),
    kind: member(value.kind, ['phrase', 'call'], 'result kind'),
    generatedAt: text(value.generatedAt, 40, 'result time'),
  }
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(result.generatedAt) || !Number.isFinite(Date.parse(result.generatedAt))) throw new Error('Check result time.')
  if (result.kind === 'phrase') {
    const p = value.phrase
    if (!object(p)) throw new Error('Missing translated phrase.')
    const pronunciation = p.pronunciation || []
    if (!Array.isArray(pronunciation) || pronunciation.length > 20) throw new Error('Check pronunciation notes.')
    result.phrase = {
      locale: text(p.locale, 35, 'phrase language'),
      target: text(p.target, 4000, 'translated phrase'),
      english: text(p.english, 4000, 'English meaning'),
      pronunciation: pronunciation.map((s) => text(s, 200, 'pronunciation note')),
    }
    try { new Intl.Locale(result.phrase.locale) } catch { throw new Error('Check phrase language.') }
  } else {
    const c = value.call
    if (!object(c) || !object(c.merchant)) throw new Error('Missing call report.')
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(c.callId || '')) throw new Error('Check call reference.')
    const evidence = c.evidence || []
    if (!Array.isArray(evidence) || evidence.length > 40) throw new Error('Check call evidence.')
    result.call = {
      callId: c.callId, state: member(c.state, states, 'call state'),
      merchant: {
        availability: member(c.merchant.availability, ['yes', 'no', 'partial', 'unknown'], 'availability result'),
        reservation: member(c.merchant.reservation, ['confirmed', 'rejected', 'unconfirmed', 'not_requested'], 'reservation result'),
      },
      summary: text(c.summary, 4000, 'English summary', false),
      evidence: evidence.map((e) => {
        if (!object(e) || !Number.isFinite(e.t) || e.t < 0) throw new Error('Check evidence timestamp.')
        return { t: e.t, role: member(e.role, ['agent', 'user'], 'evidence speaker'), text: text(e.text, 2000, 'evidence quote') }
      }),
      endedAt: text(c.endedAt, 40, 'call end time', false),
      reconciling: c.reconciling === true,
    }
    for (const key of ['confirmedLocalTime', 'confirmedName']) {
      if (c.merchant[key] != null) result.call.merchant[key] = text(c.merchant[key], 200, 'confirmation detail', false)
    }
    if (Number.isInteger(c.merchant.confirmedPartySize) && c.merchant.confirmedPartySize > 0) result.call.merchant.confirmedPartySize = c.merchant.confirmedPartySize
  }
  if (value.truncated === true) result.truncated = true
  return result
}

export async function importVoice(storage, input, { now = Date.now() } = {}) {
  return lockedWrite(() => {
    const result = validateVoiceResult(decodeVoice(input))
    const value = readVoice(storage)
    const pending = value.pending.find((p) => p.nonce === result.nonce)
    if (!pending || pending.expiresAt <= now) throw new Error('No matching voice request on this device, or it expired. Import into the browser that started it within 24 hours.')
    if (pending.ref !== result.ref || (pending.mode === 'speak' ? 'phrase' : 'call') !== result.kind) throw new Error('This result does not match the requested place or voice mode.')
    const saved = { ...result, label: pending.label || '', origin: os3Origin(pending.origin), receivedAt: new Date(now).toISOString() }
    writeVoice(storage, { ...value, pending: value.pending.filter((p) => p.nonce !== result.nonce), results: [saved, ...value.results] })
    return saved
  })
}

export async function consumeVoiceFragment(storage, location, history) {
  if (!location.hash.startsWith('#os3-voice=')) return null
  const input = location.hash.slice('#os3-voice='.length)
  // Fragments are untrusted even when source says OS3. Clear invalid input too.
  history.replaceState(null, '', location.pathname + location.search)
  try {
    if (location.origin + location.pathname !== CONCIERGE_RETURN) throw new Error('Open returned voice reports in the original Concierge app, or paste the result there.')
    await importVoice(storage, input)
    return { ok: true, message: 'OS3 report saved on this device.' }
  }
  catch (e) { return { ok: false, message: e.message } }
}

export async function deleteVoiceResult(storage, nonce) {
  return lockedWrite(() => {
    const value = readVoice(storage)
    writeVoice(storage, { ...value, results: value.results.filter((r) => r.nonce !== nonce) })
  })
}

export function callReportUrl(result) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(result.call?.callId || '')) throw new Error('Check call reference.')
  return `${os3Origin(result.origin)}/#voice-call=${result.call.callId}`
}

export function deviceVoice(voices, locale) {
  const language = locale.toLowerCase()
  return voices.find((v) => v.lang.toLowerCase() === language)
    || voices.find((v) => v.lang.toLowerCase().split('-')[0] === language.split('-')[0])
    || null
}
