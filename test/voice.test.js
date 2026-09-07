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
async function ready(mode = 'speak', options = {}) {
  const store = storage()
  await beginVoice(store, { ...draft, mode }, { nonce, now, ...options })
  return store
}

describe('OS3 voice handoff', () => {
  it('encodes Unicode without sending restaurant details in a query or path', async () => {
    const { value, url } = buildVoicePrefill(draft, { nonce })
    expect(new URL(url).search).toBe('')
    expect(new URL(url).pathname).toBe('/')
    expect(value.return).toBe('https://bloklabs.github.io/os3-concierge/')
    expect(decodeVoice(new URL(url).hash.slice(7))).toEqual(value)
    expect(decodeVoice(encodeVoice({ text: '日本語・¿txuleta?' }))).toEqual({ text: '日本語・¿txuleta?' })
  })

  it.each(['https://evil.example', 'https://os.unitary.com.evil.example', 'http://os.unitary.com', 'https://os.unitary.com/path', 'https://user@os.unitary.com', 'https://os.unitary.com?token=x'])('refuses an unapproved OS3 destination: %s', async (origin) => {
    expect(() => buildVoicePrefill(draft, { nonce, origin })).toThrow('approved OS3')
  })

  it.each(['', '+3400 ext123', '943293763', 'tel:+34943293763'])('rejects invalid nonempty phone %s', async (phone) => {
    if (!phone) expect(buildVoicePrefill({ ...draft, phone }, { nonce }).value.restaurant.phone).toBe('')
    else expect(() => buildVoicePrefill({ ...draft, phone }, { nonce })).toThrow('international')
  })

  it('requires a language, instruction, mode and strong nonce', async () => {
    for (const patch of [{ locale: 'auto' }, { instruction: ' ' }, { mode: 'dial-now' }]) expect(() => buildVoicePrefill({ ...draft, ...patch }, { nonce })).toThrow()
    expect(() => buildVoicePrefill(draft, { nonce: 'short' })).toThrow('secure')
    expect(buildVoicePrefill({ ...draft, locale: 'en-GB' }, { nonce }).value.restaurant.phone).toBe('+34943293763')
  })

  it('caps decoded UTF-8, not just JavaScript characters, and rejects malformed input', async () => {
    expect(() => encodeVoice({ text: '語'.repeat(3000) })).toThrow('large')
    expect(() => decodeVoice(JSON.stringify({ text: '語'.repeat(3000) }))).toThrow('large')
    for (const value of ['_', '%%%%', 'bnVsbA', '[1,2]', '\u007bnot-json', 'a'.repeat(11000)]) expect(() => decodeVoice(value)).toThrow()
  })

  it('persists the request and draft before returning a navigation URL', async () => {
    const store = await ready()
    expect(readVoice(store).pending[0]).toMatchObject({ nonce, ref: 'bar-desy', mode: 'speak', origin: 'https://os.unitary.com', expiresAt: now + VOICE_TTL_MS })
    expect(readVoice(store).draft).toEqual(draft)
    expect(store.getItem('wander.space')).toBe('untouched')
    expect(store.setItem).toHaveBeenCalledTimes(1)
  })

  it('does not launch when the device cannot persist its request', async () => {
    const store = storage()
    store.setItem = () => { throw new Error('quota') }
    await expect(beginVoice(store, draft, { nonce, now })).rejects.toThrow('Could not save')
    expect(readVoice(store).pending).toEqual([])
  })

  it('imports once, stores only selected data, and preserves existing settings', async () => {
    const store = await ready()
    const input = { ...phrase(), secret: 'must-not-persist', origin: 'https://evil.example', phrase: { ...phrase().phrase, secret: 'must-not-persist' } }
    const result = await importVoice(store, JSON.stringify(input), { now: now + 100000 })
    expect(result.origin).toBe('https://os.unitary.com')
    expect(result.phrase.target).toContain('cuatro')
    expect(readVoice(store).pending).toEqual([])
    expect(store.getItem(VOICE_KEY)).not.toContain('must-not-persist')
    expect(store.getItem('wander.space')).toBe('untouched')
    await expect(importVoice(store, encodeVoice(input), { now: now + 100001 })).rejects.toThrow('No matching')
  })

  it('allows retry after a failed result save without consuming its request', async () => {
    const store = await ready()
    const set = store.setItem
    store.setItem = () => { throw new Error('quota') }
    await expect(importVoice(store, encodeVoice(phrase()), { now })).rejects.toThrow('Could not save')
    expect(readVoice(store).pending).toHaveLength(1)
    store.setItem = set
    expect((await importVoice(store, encodeVoice(phrase()), { now })).kind).toBe('phrase')
  })

  it('binds returned data to an outstanding request, place and mode', async () => {
    const store = await ready()
    await expect(importVoice(store, encodeVoice({ ...phrase(), nonce: 'wrong-request-123456' }), { now })).rejects.toThrow('No matching')
    await expect(importVoice(store, encodeVoice({ ...phrase(), ref: 'another-place' }), { now })).rejects.toThrow('does not match')
    await expect(importVoice(store, encodeVoice(call()), { now })).rejects.toThrow('does not match')
    await expect(importVoice(store, encodeVoice(phrase()), { now: now + VOICE_TTL_MS })).rejects.toThrow('expired')
    expect(readVoice(store).results).toEqual([])
  })

  it('keeps call transport completion separate from merchant acceptance', async () => {
    const store = await ready('call', { origin: 'https://staging.os.unitary.com' })
    const result = await importVoice(store, encodeVoice(call()), { now })
    expect(result.call.state).toBe('completed')
    expect(result.call.merchant.reservation).toBe('unconfirmed')
    expect(result.call.evidence[0].text).toBe('No puedo confirmar.')
    expect(callReportUrl(result)).toBe('https://staging.os.unitary.com/#voice-call=call_123')
  })

  it('retains a reconciling snapshot without reporting it as a final outcome', async () => {
    const value = call(); value.call.state = 'dialing'; value.call.reconciling = true
    expect(validateVoiceResult(value).call).toMatchObject({ state: 'dialing', reconciling: true })
    value.call.state = 'cancel_requested'
    expect(validateVoiceResult(value).call.state).toBe('cancel_requested')
  })

  it('rejects unsafe or malformed result fields before consuming the nonce', async () => {
    const store = await ready('call')
    for (const mutate of [
      (v) => { v.source = 'other' }, (v) => { v.v = 2 },
      (v) => { v.generatedAt = 'not-a-date' }, (v) => { v.call.callId = '../admin' },
      (v) => { v.call.state = 'booked' }, (v) => { v.call.merchant.reservation = 'probably' },
      (v) => { v.call.evidence[0].t = -1 }, (v) => { v.call.evidence[0].role = 'system' },
    ]) { const value = call(); mutate(value); await expect(importVoice(store, encodeVoice(value), { now })).rejects.toThrow() }
    expect(readVoice(store).pending).toHaveLength(1)
  })

  it('clears fragments even on malformed or wrong-origin returns', async () => {
    const history = { replaceState: vi.fn() }
    const location = { hash: '#os3-voice=invalid', origin: 'https://bloklabs.github.io', pathname: '/os3-concierge/', search: '?x=1' }
    expect((await consumeVoiceFragment(storage(), location, history)).ok).toBe(false)
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/os3-concierge/?x=1')
    expect((await consumeVoiceFragment(storage(), { ...location, origin: 'https://evil.example' }, history)).message).toContain('original Concierge')
    expect((await consumeVoiceFragment(storage(), { ...location, hash: '#unrelated' }, history))).toBeNull()
  })

  it('accepts a matching fragment only at the canonical Concierge location', async () => {
    const store = await ready()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 1000)
    try {
      const location = { hash: '#os3-voice=' + encodeVoice(phrase()), origin: 'https://bloklabs.github.io', pathname: '/os3-concierge/', search: '' }
      expect((await consumeVoiceFragment(store, location, { replaceState: vi.fn() })).ok).toBe(true)
      expect(readVoice(store).results[0].label).toBe('BAR DESY')
    } finally { clock.mockRestore() }
  })

  it('keeps saved text offline and deletes only the explicitly selected result', async () => {
    const store = await ready()
    await importVoice(store, encodeVoice(phrase()), { now })
    await saveVoiceDraft(store, { instruction: 'A new request' })
    expect(readVoice(store).results[0].phrase.english).toContain('four')
    await deleteVoiceResult(store, 'not-there')
    expect(readVoice(store).results).toHaveLength(1)
    await deleteVoiceResult(store, nonce)
    expect(readVoice(store).results).toEqual([])
    expect(readVoice(store).draft.instruction).toBe('A new request')
  })

  it('preserves corrupt saved data instead of replacing it with an empty store', async () => {
    const store = storage(); store.setItem(VOICE_KEY, 'broken')
    await expect(saveVoiceDraft(store, draft)).rejects.toThrow('kept')
    expect(store.getItem(VOICE_KEY)).toBe('broken')
  })

  it('selects a matching device voice and never falls back to another language', async () => {
    const english = { lang: 'en-US' }, spanish = { lang: 'es-MX' }, local = { lang: 'es-ES' }
    expect(deviceVoice([english, spanish, local], 'es-ES')).toBe(local)
    expect(deviceVoice([english, spanish], 'es-ES')).toBe(spanish)
    expect(deviceVoice([english], 'ja-JP')).toBeNull()
  })

  it('serializes simultaneous imports so a nonce can only be consumed once', async () => {
    const store = await ready()
    const outcomes = await Promise.allSettled([
      importVoice(store, encodeVoice(phrase()), { now }),
      importVoice(store, encodeVoice(phrase()), { now }),
    ])
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1)
    expect(readVoice(store).results).toHaveLength(1)
    expect(readVoice(store).pending).toEqual([])
  })

  it('preserves independent concurrent reports and a concurrent draft write', async () => {
    const store = await ready()
    const second = 'another-request-123456'
    await beginVoice(store, draft, { nonce: second, now })
    await Promise.all([
      importVoice(store, encodeVoice(phrase()), { now }),
      importVoice(store, encodeVoice({ ...phrase(), nonce: second }), { now }),
      saveVoiceDraft(store, { instruction: 'next request' }),
    ])
    expect(readVoice(store).results).toHaveLength(2)
    expect(readVoice(store).pending).toEqual([])
    expect(readVoice(store).draft.instruction).toBe('next request')
  })

  it('refuses writes without cross-tab locks and keeps offline reads available', async () => {
    const store = await ready()
    vi.stubGlobal('navigator', {})
    try {
      await expect(saveVoiceDraft(store, draft)).rejects.toThrow('cross-tab storage locking')
      expect(readVoice(store).pending).toHaveLength(1)
    } finally { vi.unstubAllGlobals() }
  })
})
