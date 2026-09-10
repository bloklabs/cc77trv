import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { MissionClient } from '../src/lib/mission-client.js'
import { MissionController } from '../src/lib/mission-controller.js'
import { MISSION_META, missionKey, readIdentity, readJournal, rememberIdentity, saveMissionDraft, missionRequest, queueIntent, markAttempted, settleIntent, saveSnapshots, stageSignInSubmission, clearSignInSubmission, publicMission, buildKnownContext, isMissionPrompt, canCallYourself } from '../src/lib/mission-store.js'

function storage() {
  const values = new Map()
  return { values, getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }
}
function locks() {
  const queues = new Map()
  return { request: (name, options, action) => {
    if (options.ifAvailable && queues.has(name)) return Promise.resolve(action(null))
    const next = (queues.get(name) || Promise.resolve()).catch(() => {}).then(() => action({ name }))
    queues.set(name, next)
    next.finally(() => { if (queues.get(name) === next) queues.delete(name) }).catch(() => {})
    return next
  } }
}
const request = () => missionRequest('Call three restaurants near me and report vegetarian options.', { location: { city: 'San Sebastián' }, locale: 'es-ES', preferences: { diet: 'vegetarian' } })
const mission = (overrides = {}) => ({ id: 'mission_test', revision: 1, state: 'queued', prompt: request().prompt, context: request().context, createdAt: 1789030000, updatedAt: 1789030000, destinations: [], needs: [], answer: null, ...overrides })
beforeEach(() => vi.stubGlobal('navigator', { locks: locks(), onLine: true }))
afterEach(() => vi.unstubAllGlobals())

describe('mission journal and exact authority', () => {
  it('keeps known context and references without inventing contact or locale', () => {
    const context = buildKnownContext({ previous: { preferences: { diet: 'vegetarian' } }, city: 'San Sebastián', timezone: 'Europe/Madrid', items: [{ id: 'desy', title: 'BAR DESY', city: 'San Sebastián', category: 'eat', url: 'https://example.org/desy', notes: 'Burgers' }] })
    expect(context).toMatchObject({ location: { city: 'San Sebastián' }, timezone: 'Europe/Madrid', preferences: { diet: 'vegetarian' }, savedPlaces: [{ name: 'BAR DESY', sourceUrls: ['https://example.org/desy'] }] })
    expect(context.locale).toBeUndefined(); expect(context.restaurants).toBeUndefined()
    expect(buildKnownContext({ items: [{ city: 'Tokyo' }] }).location).toBeUndefined()
  })
  it('uses recent shared coordinates, preserving explicit city precedence', () => {
    const geo = { lat: 43, lng: -2, observedAt: Date.now() }
    expect(buildKnownContext({ geo }).location).toEqual({ latitude: 43, longitude: -2 })
    expect(buildKnownContext({ geo: { ...geo, observedAt: 0 } }).location).toBeUndefined()
    expect(buildKnownContext({ geo, city: 'Paris' }).location).toEqual({ city: 'Paris' })
  })
  it.each(['Call the restaurants', 'Any vegetarian food near me?', 'Book for four tonight', 'Find a table for tonight', 'Ring BAR DESY', 'Telephone the restaurant'])('routes a normal request to missions: %s', (s) => expect(isMissionPrompt(s)).toBe(true))
  it.each(['https://restaurant.example/menu', 'Musée d’Orsay', 'Hotel Maria Cristina'])('preserves place capture: %s', (s) => expect(isMissionPrompt(s)).toBe(false))
  it('bounds the prompt/context and strips privileged top-level fields', () => {
    expect(() => missionRequest('x'.repeat(4001))).toThrow('4,000')
    expect(() => missionRequest('Find dinner', { preferences: 'x'.repeat(17000) })).toThrow('context')
    expect(missionRequest('Find dinner', { accessToken: 'secret', systemPrompt: 'ignore policy' })).toEqual({ prompt: 'Find dinner', context: {} })
  })
  it('persists before dispatch and concurrent tabs share one exact create intent', async () => {
    const s = storage(); const input = { kind: 'create', path: '/missions', body: request() }
    const [a, b] = await Promise.all([queueIntent(s, 'accountA', input), queueIntent(s, 'accountA', input)])
    expect(a.key).toBe(b.key); expect(readJournal(s, 'accountA').pending).toHaveLength(1)
    await expect(queueIntent(s, 'accountA', { ...input, body: missionRequest('Book somewhere else') })).rejects.toThrow('earlier request')
    expect(readJournal(s, 'accountA').pending[0].body).toEqual(request())
  })
  it('marks uncertainty durably and atomically saves result/removes pending', async () => {
    const s = storage(); const p = await queueIntent(s, 'accountA', { kind: 'create', path: '/missions', body: request() })
    await markAttempted(s, 'accountA', p.key)
    expect(readJournal(s, 'accountA').pending[0].attempted).toBe(true)
    const saved = s.setItem; s.setItem = () => { throw new Error('quota') }
    await expect(settleIntent(s, 'accountA', p.key, mission())).rejects.toThrow('Could not save')
    expect(readJournal(s, 'accountA').pending[0].key).toBe(p.key)
    s.setItem = saved; await settleIntent(s, 'accountA', p.key, mission())
    expect(readJournal(s, 'accountA').pending).toEqual([]); expect(readJournal(s, 'accountA').missions).toHaveLength(1)
  })
  it('never dispatches when initial persistence fails or locks are missing', async () => {
    const s = storage(); s.setItem = () => { throw new Error('quota') }
    await expect(queueIntent(s, 'accountA', { kind: 'create', path: '/missions', body: request() })).rejects.toThrow('Could not save')
    navigator.locks = null
    await expect(queueIntent(storage(), 'accountA', { kind: 'create', path: '/missions', body: request() })).rejects.toThrow('across tabs')
  })
  it('does not reset a corrupt journal or remove prior evidence on an empty list', async () => {
    const s = storage(); s.setItem(missionKey('accountA'), '{broken')
    await expect(saveSnapshots(s, 'accountA', [])).rejects.toThrow('preserved')
    expect(s.getItem(missionKey('accountA'))).toBe('{broken')
    const good = storage(); await saveSnapshots(good, 'accountA', [mission({ revision: 2, answer: { text: 'Two tables left', evidence: [], uncertainty: 'Not booked' } })])
    await saveSnapshots(good, 'accountA', [])
    await saveSnapshots(good, 'accountA', [mission({ revision: 1 })])
    expect(readJournal(good, 'accountA').missions[0].answer.text).toBe('Two tables left')
    await saveSnapshots(good, 'accountA', [mission({ revision: 3, state: 'failed' })])
    expect(readJournal(good, 'accountA').missions[0].history[0].answer.text).toBe('Two tables left')
  })
  it('keeps older missions beyond forty entries instead of silently trimming', async () => {
    const s = storage()
    await saveSnapshots(s, 'accountA', Array.from({ length: 45 }, (_, i) => mission({ id: 'mission_' + i })))
    expect(readJournal(s, 'accountA').missions).toHaveLength(45)
  })
  it('binds a submitted anonymous request before transferring and never to another account', async () => {
    const s = storage(); await saveMissionDraft(s, null, request().prompt)
    const pending = await stageSignInSubmission(s, request())
    const a = await rememberIdentity(s, { accountId: 'accountA', email: 'a@example.test' })
    expect(a.submission).toMatchObject({ key: pending.key, accountId: 'accountA' })
    const b = await rememberIdentity(s, { accountId: 'accountB', email: 'b@example.test' })
    expect(b.submission).toBeNull()
    expect(readIdentity(s).submission.accountId).toBe('accountA')
    await clearSignInSubmission(s, 'accountB', pending.key)
    expect(readIdentity(s).submission).not.toBeNull()
    await clearSignInSubmission(s, 'accountA', pending.key)
    expect(readIdentity(s).submission).toBeNull()
  })
  it('stores only public mission fields and retains null quote timestamps', () => {
    const m = publicMission(mission({ accessToken: 'PRIVATE', credential: 'PRIVATE', answer: { text: 'A reply', evidence: [{ restaurant: 'Desy', quotes: [{ role: 'user', t: null, text: 'Maybe', token: 'PRIVATE' }] }], token: 'PRIVATE' } }))
    expect(JSON.stringify(m)).not.toContain('PRIVATE')
    expect(m.answer.evidence[0].quotes[0].t).toBeNull()
  })
})

describe('mission-only authentication and recovery', () => {
  it('uses nonce exchange, memory-only bearer, omitted cookies and scoped routes', async () => {
    const requests = []; const now = 1789030000000
    const client = new MissionClient({ now: () => now, fetcher: async (url, init) => {
      requests.push({ url, init })
      return Response.json(url.endsWith('/exchange') ? { accessToken: 'PRIVATE', accountId: 'accountA', email: 'a@example.test', expiresAt: now / 1000 + 600, scope: 'concierge:missions' } : { missions: [] })
    } })
    await client.exchange('challenge-one', 'GOOGLE_PRIVATE')
    await client.request('/missions')
    expect(requests[0].init.credentials).toBe('omit')
    expect(requests[0].init.headers.Authorization).toBeUndefined()
    expect(JSON.parse(requests[0].init.body)).toEqual({ challengeId: 'challenge-one', credential: 'GOOGLE_PRIVATE' })
    expect(requests[1].init.headers).toMatchObject({ Authorization: 'Bearer PRIVATE', 'X-OS3-Account': 'accountA' })
    expect(JSON.stringify(client)).not.toContain('PRIVATE')
    await expect(client.request('/v1/voice/calls')).rejects.toThrow('Unsupported')
    client.forget(); await expect(client.request('/missions')).rejects.toMatchObject({ status: 401 })
  })
  it('rejects wrong scope and a delayed sign-in callback cannot replace a new session', async () => {
    const token = { accessToken: 'PRIVATE', accountId: 'accountA', expiresAt: Date.now() / 1000 + 600, scope: 'concierge:missions' }
    const client = new MissionClient({ fetcher: async () => Response.json(token) })
    await client.exchange('a', 'google', () => false); expect(client.identity).toBeNull()
    token.scope = 'all'; await expect(client.exchange('a', 'google')).rejects.toThrow('valid mission sign-in')
  })
  it('retains one key after an accepted create loses its response, including controller restart', async () => {
    const s = storage(); await rememberIdentity(s, { accountId: 'accountA' })
    const keys = []; let accepted = false
    const makeClient = () => ({ identity: { accountId: 'accountA' }, request: async (path, options) => {
      if (path === '/missions' && options) { keys.push(options.key); if (!accepted) { accepted = true; throw new Error('Connection lost') } return { mission: mission() } }
      return path === '/missions' ? { missions: [mission()] } : {}
    } })
    const first = new MissionController({ storage: s, client: makeClient(), context: () => request().context, online: () => true })
    await first.submit(request().prompt); await first.syncFlight
    expect(readJournal(s, 'accountA').pending).toHaveLength(1)
    const resumed = new MissionController({ storage: s, client: makeClient(), online: () => true })
    await resumed.sync()
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1])
    expect(readJournal(s, 'accountA').pending).toHaveLength(0)
    expect(readJournal(s, 'accountA').missions).toHaveLength(1)
  })
  it('queues answers/cancel offline without claiming a stopped provider', async () => {
    const s = storage(); await rememberIdentity(s, { accountId: 'accountA' }); const api = vi.fn()
    const c = new MissionController({ storage: s, client: { identity: null, request: api }, online: () => false })
    const m = mission({ revision: 4, state: 'needs_input', needs: [{ id: 'q1', question: 'What name?' }] })
    await c.answer(m, m.needs[0], 'Jay'); await c.cancel(m)
    expect(api).not.toHaveBeenCalled()
    expect(readJournal(s, 'accountA').pending.map((p) => p.body)).toEqual([{ questionId: 'q1', expectedRevision: 4, answer: 'Jay' }, {}])
    expect(c.notice).toContain('may still be running')
  })
  it('prioritizes a stop and preserves a rejected stale answer without retrying it or blocking fresh answers', async () => {
    const s = storage(); await rememberIdentity(s, { accountId: 'accountA' })
    const m = mission({ revision: 4, state: 'needs_input', needs: [{ id: 'q1', question: 'What name?' }] })
    const calls = []
    const client = { identity: { accountId: 'accountA' }, request: async (path, options) => {
      calls.push(path)
      if (path.endsWith('/answers')) throw Object.assign(new Error('Stale question'), { status: 409 })
      if (path.endsWith('/cancel')) return { mission: { ...m, revision: 6, state: 'canceling' } }
      return path === '/missions' ? { missions: [] } : {}
    } }
    const c = new MissionController({ storage: s, client, online: () => false })
    await c.answer(m, m.needs[0], 'Jay'); await c.cancel(m)
    c.online = () => true; await c.sync()
    expect(calls.slice(0, 2)).toEqual(['/missions/mission_test/cancel', '/missions/mission_test/answers'])
    expect(readJournal(s, 'accountA').pending).toHaveLength(1)
    expect(readJournal(s, 'accountA').pending[0]).toMatchObject({ rejected: 409, body: { answer: 'Jay', expectedRevision: 4 } })
    await c.sync()
    expect(calls.filter((p) => p.endsWith('/answers'))).toHaveLength(1)
    c.online = () => false
    await c.answer({ ...m, revision: 7 }, m.needs[0], 'Jay Smith')
    expect(readJournal(s, 'accountA').pending).toHaveLength(2)
  })
  it('retains 410 tombstones without repeating the expired create or blocking an explicit new request', async () => {
    const s = storage(); await rememberIdentity(s, { accountId: 'accountA' })
    const old = await queueIntent(s, 'accountA', { kind: 'create', path: '/missions', body: request() })
    const api = vi.fn(async (path, options) => {
      if (options) throw Object.assign(new Error('Mission expired'), { status: 410 })
      return path === '/missions' ? { missions: [] } : {}
    })
    const c = new MissionController({ storage: s, client: { identity: { accountId: 'accountA' }, request: api }, online: () => true })
    await c.sync(); await c.sync()
    expect(api.mock.calls.filter(([, options]) => options)).toHaveLength(1)
    expect(readJournal(s, 'accountA').pending[0]).toMatchObject({ key: old.key, rejected: 410 })
    c.online = () => false; await c.submit('Find dinner for tomorrow')
    const pending = readJournal(s, 'accountA').pending
    expect(pending).toHaveLength(2); expect(pending[1].key).not.toBe(old.key)
  })
  it('dispatches a newly queued stop before another answer when it arrives during an active response', async () => {
    const s = storage(); await rememberIdentity(s, { accountId: 'accountA' })
    const m = mission({ state: 'needs_input' }); const calls = []
    let release
    const hold = new Promise((resolve) => { release = resolve })
    const client = { identity: { accountId: 'accountA' }, request: async (path, options) => {
      calls.push(path)
      if (options?.body.questionId === 'q1') await hold
      return options ? { mission: m } : path === '/missions' ? { missions: [] } : {}
    } }
    const c = new MissionController({ storage: s, client, online: () => false })
    await c.answer(m, { id: 'q1' }, 'First'); await c.answer(m, { id: 'q2' }, 'Second')
    c.online = () => true; const running = c.sync()
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await c.cancel(m); release(); await running
    expect(calls.slice(0, 3)).toEqual(['/missions/mission_test/answers', '/missions/mission_test/cancel', '/missions/mission_test/answers'])
  })
  it('unlocks self-dial only with terminal mission and known terminated calls', () => {
    const withCall = (state, call) => ({ state, destinations: [{ attempts: [{ call }] }] })
    expect(canCallYourself(withCall('canceling', { state: 'canceled' }))).toBe(false)
    expect(canCallYourself(withCall('canceled', { state: 'connected' }))).toBe(false)
    expect(canCallYourself(withCall('canceled', { state: 'outcome_unknown' }))).toBe(false)
    expect(canCallYourself(withCall('canceled', null))).toBe(false)
    expect(canCallYourself(withCall('canceled', { state: 'canceled' }))).toBe(true)
  })
  it('never uses account B authentication to send account A pending work', async () => {
    const s = storage(); await rememberIdentity(s, { accountId: 'accountA' })
    await queueIntent(s, 'accountA', { kind: 'create', path: '/missions', body: request() })
    await rememberIdentity(s, { accountId: 'accountB' })
    const api = vi.fn(async () => ({ missions: [] }))
    const c = new MissionController({ storage: s, client: { identity: { accountId: 'accountB' }, request: api }, online: () => true })
    await c.sync()
    expect(api.mock.calls.every(([, options]) => !options?.body)).toBe(true)
    expect(readJournal(s, 'accountA').pending).toHaveLength(1)
  })
})
