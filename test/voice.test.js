import { describe, it, expect, vi } from 'vitest'
import {
  VOICE_KEY, VOICE_TTL_MS, encodeVoice, decodeVoice, buildVoicePrefill,
  beginVoice, readVoice, importVoice, saveVoiceDraft, consumeVoiceFragment,
  deleteVoiceResult, callReportUrl, deviceVoice, validateVoiceResult,
} from '../src/lib/voice.js'

const now = Date.parse('2026-09-07T17:00:00Z')
const nonce = 'a-request-1234567890'
const draft = { ref: 'bar-desy', mode: 'speak', locale: 'es-ES', instruction: 'Ask for four burgers at 20:15.', restaurantName: 'BAR DESY', city: 'San Sebastián', phone: '+34943293763' }
const phrase = () => ({ v: 1, source: 'os3-voice', ref: 'bar-desy', nonce, kind: 'phrase', generatedAt: '2026-09-07T17:01:00Z', phrase: { locale: 'es-ES', target: '¿Os quedan cuatro hamburguesas de txuleta?', english: 'Do you have four txuleta burgers left?', pronunciation: ['txuleta: choo-LEH-tah'] } })
const call = () => ({ v: 1, source: 'os3-voice', ref: 'bar-desy', nonce, kind: 'call', generatedAt: '2026-09-07T17:01:00Z', call: { callId: 'call_123', state: 'completed', merchant: { availability: 'unknown', reservation: 'unconfirmed' }, summary: 'The call ended without a confirmed booking.', evidence: [{ t: 20, role: 'user', text: 'No puedo confirmar.' }] } })
function storage() {
  const map = new Map([['wander.space', 'untouched']])
  return { getItem: (key) => map.get(key) ?? null, setItem: vi.fn((key, value) => map.set(key, value)) }
}
function ready(mode = 'speak', options = {}) {
  const store = storage()
  beginVoice(store, { ...draft, mode }, { nonce, now, ...options })
  return store
}

describe('OS3 voice handoff', () => {
  it('encodes Unicode without sending restaurant details in a query or path', () => {
    const { value, url } = buildVoicePrefill(draft, { nonce })
    expect(new URL(url).search).toBe('')
    expect(new URL(url).pathname).toBe('/')
    expect(value.return).toBe('https://bloklabs.github.io/os3-concierge/')
    expect(decodeVoice(new URL(url).hash.slice(7))).toEqual(value)
    expect(decodeVoice(encodeVoice({ text: '日本語・¿txuleta?' }))).toEqual({ text: '日本語・¿txuleta?' })
  })

  it.each(['https://evil.example', 'https://os.unitary.com.evil.example', 'http://os.unitary.com', 'https://os.unitary.com/path', 'https://user@os.unitary.com', 'https://os.unitary.com?token=x'])('refuses an unapproved OS3 destination: %s', (origin) => {
    expect(() => buildVoicePrefill(draft, { nonce, origin })).toThrow('approved OS3')
  })

  it.each(['', '+3400 ext123', '943293763', 'tel:+34943293763'])('rejects invalid nonempty phone %s', (phone) => {
    if (!phone) expect(buildVoicePrefill({ ...draft, phone }, { nonce }).value.restaurant.phone).toBe('')
    else expect(() => buildVoicePrefill({ ...draft, phone }, { nonce })).toThrow('international')
  })

  it('requires a language, instruction, mode and strong nonce', () => {
    for (const patch of [{ locale: 'auto' }, { instruction: ' ' }, { mode: 'dial-now' }]) expect(() => buildVoicePrefill({ ...draft, ...patch }, { nonce })).toThrow()
    expect(() => buildVoicePrefill(draft, { nonce: 'short' })).toThrow('secure')
    expect(buildVoicePrefill({ ...draft, locale: 'en-GB' }, { nonce }).value.restaurant.phone).toBe('+34943293763')
  })

  it('caps decoded UTF-8, not just JavaScript characters, and rejects malformed input', () => {
    expect(() => encodeVoice({ text: '語'.repeat(3000) })).toThrow('large')
    expect(() => decodeVoice(JSON.stringify({ text: '語'.repeat(3000) }))).toThrow('large')
    for (const value of ['_', '%%%%', 'bnVsbA', '[1,2]', '\u007bnot-json', 'a'.repeat(11000)]) expect(() => decodeVoice(value)).toThrow()
  })

  it('persists the request and draft before returning a navigation URL', () => {
    const store = ready()
    expect(readVoice(store).pending[0]).toMatchObject({ nonce, ref: 'bar-desy', mode: 'speak', origin: 'https://os.unitary.com', expiresAt: now + VOICE_TTL_MS })
    expect(readVoice(store).draft).toEqual(draft)
    expect(store.getItem('wander.space')).toBe('untouched')
    expect(store.setItem).toHaveBeenCalledTimes(1)
  })

  it('does not launch when the device cannot persist its request', () => {
    const store = storage()
    store.setItem = () => { throw new Error('quota') }
    expect(() => beginVoice(store, draft, { nonce, now })).toThrow('Could not save')
    expect(readVoice(store).pending).toEqual([])
  })

  it('imports once, stores only selected data, and preserves existing settings', () => {
    const store = ready()
    const input = { ...phrase(), secret: 'must-not-persist', origin: 'https://evil.example', phrase: { ...phrase().phrase, secret: 'must-not-persist' } }
    const result = importVoice(store, JSON.stringify(input), { now: now + 100000 })
    expect(result.origin).toBe('https://os.unitary.com')
    expect(result.phrase.target).toContain('cuatro')
    expect(readVoice(store).pending).toEqual([])
    expect(store.getItem(VOICE_KEY)).not.toContain('must-not-persist')
    expect(store.getItem('wander.space')).toBe('untouched')
    expect(() => importVoice(store, encodeVoice(input), { now: now + 100001 })).toThrow('No matching')
  })

  it('allows retry after a failed result save without consuming its request', () => {
    const store = ready()
    const set = store.setItem
    store.setItem = () => { throw new Error('quota') }
    expect(() => importVoice(store, encodeVoice(phrase()), { now })).toThrow('Could not save')
    expect(readVoice(store).pending).toHaveLength(1)
    store.setItem = set
    expect(importVoice(store, encodeVoice(phrase()), { now }).kind).toBe('phrase')
  })

  it('binds returned data to an outstanding request, place and mode', () => {
    const store = ready()
    expect(() => importVoice(store, encodeVoice({ ...phrase(), nonce: 'wrong-request-123456' }), { now })).toThrow('No matching')
    expect(() => importVoice(store, encodeVoice({ ...phrase(), ref: 'another-place' }), { now })).toThrow('does not match')
    expect(() => importVoice(store, encodeVoice(call()), { now })).toThrow('does not match')
    expect(() => importVoice(store, encodeVoice(phrase()), { now: now + VOICE_TTL_MS })).toThrow('expired')
    expect(readVoice(store).results).toEqual([])
  })

  it('keeps call transport completion separate from merchant acceptance', () => {
    const store = ready('call', { origin: 'https://staging.os.unitary.com' })
    const result = importVoice(store, encodeVoice(call()), { now })
    expect(result.call.state).toBe('completed')
    expect(result.call.merchant.reservation).toBe('unconfirmed')
    expect(result.call.evidence[0].text).toBe('No puedo confirmar.')
    expect(callReportUrl(result)).toBe('https://staging.os.unitary.com/#voice-call=call_123')
  })

  it('retains a reconciling snapshot without reporting it as a final outcome', () => {
    const value = call(); value.call.state = 'dialing'; value.call.reconciling = true
    expect(validateVoiceResult(value).call).toMatchObject({ state: 'dialing', reconciling: true })
    value.call.state = 'cancel_requested'
    expect(validateVoiceResult(value).call.state).toBe('cancel_requested')
  })

  it('rejects unsafe or malformed result fields before consuming the nonce', () => {
    const store = ready('call')
    for (const mutate of [
      (v) => { v.source = 'other' }, (v) => { v.v = 2 },
      (v) => { v.generatedAt = 'not-a-date' }, (v) => { v.call.callId = '../admin' },
      (v) => { v.call.state = 'booked' }, (v) => { v.call.merchant.reservation = 'probably' },
      (v) => { v.call.evidence[0].t = -1 }, (v) => { v.call.evidence[0].role = 'system' },
    ]) { const value = call(); mutate(value); expect(() => importVoice(store, encodeVoice(value), { now })).toThrow() }
    expect(readVoice(store).pending).toHaveLength(1)
  })

  it('clears fragments even on malformed or wrong-origin returns', () => {
    const history = { replaceState: vi.fn() }
    const location = { hash: '#os3-voice=invalid', origin: 'https://bloklabs.github.io', pathname: '/os3-concierge/', search: '?x=1' }
    expect(consumeVoiceFragment(storage(), location, history).ok).toBe(false)
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/os3-concierge/?x=1')
    expect(consumeVoiceFragment(storage(), { ...location, origin: 'https://evil.example' }, history).message).toContain('original Concierge')
    expect(consumeVoiceFragment(storage(), { ...location, hash: '#unrelated' }, history)).toBeNull()
  })

  it('accepts a matching fragment only at the canonical Concierge location', () => {
    const store = ready()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 1000)
    try {
      const location = { hash: '#os3-voice=' + encodeVoice(phrase()), origin: 'https://bloklabs.github.io', pathname: '/os3-concierge/', search: '' }
      expect(consumeVoiceFragment(store, location, { replaceState: vi.fn() }).ok).toBe(true)
      expect(readVoice(store).results[0].label).toBe('BAR DESY')
    } finally { clock.mockRestore() }
  })

  it('keeps saved text offline and deletes only the explicitly selected result', () => {
    const store = ready()
    importVoice(store, encodeVoice(phrase()), { now })
    saveVoiceDraft(store, { instruction: 'A new request' })
    expect(readVoice(store).results[0].phrase.english).toContain('four')
    deleteVoiceResult(store, 'not-there')
    expect(readVoice(store).results).toHaveLength(1)
    deleteVoiceResult(store, nonce)
    expect(readVoice(store).results).toEqual([])
    expect(readVoice(store).draft.instruction).toBe('A new request')
  })

  it('preserves corrupt saved data instead of replacing it with an empty store', () => {
    const store = storage(); store.setItem(VOICE_KEY, 'broken')
    expect(() => saveVoiceDraft(store, draft)).toThrow('kept')
    expect(store.getItem(VOICE_KEY)).toBe('broken')
  })

  it('selects a matching device voice and never falls back to another language', () => {
    const english = { lang: 'en-US' }, spanish = { lang: 'es-MX' }, local = { lang: 'es-ES' }
    expect(deviceVoice([english, spanish, local], 'es-ES')).toBe(local)
    expect(deviceVoice([english, spanish], 'es-ES')).toBe(spanish)
    expect(deviceVoice([english], 'ja-JP')).toBeNull()
  })
})
