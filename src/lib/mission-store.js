// Only public mission text and exact mutation intents enter this journal.
// Identity credentials are owned by the in-memory auth client.
export const MISSION_META = 'os3-concierge.missions.identity.v1'
export const MISSION_PREFIX = 'os3-concierge.missions.v1.'
export const MISSION_STATES = ['queued', 'dialing', 'speaking', 'waiting', 'needs_input', 'completed', 'failed', 'canceling', 'canceled']
export const terminalMission = (m) => ['completed', 'failed', 'canceled'].includes(m.state)
const object = (x) => x && typeof x === 'object' && !Array.isArray(x)
const clone = (x) => JSON.parse(JSON.stringify(x))
const empty = () => ({ v: 1, draft: '', context: {}, contextAt: 0, pending: [], missions: [], replies: {} })
const identifier = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(s)
export const missionKey = (account) => {
  if (!identifier(account)) throw new Error('Sign in to the account for this request.')
  return MISSION_PREFIX + account
}

function read(storage, key, fallback) {
  try { return storage.getItem(key) ? JSON.parse(storage.getItem(key)) : fallback() }
  catch { throw new Error('Saved Concierge data could not be read. It has been preserved.') }
}
function write(storage, key, value) {
  try { storage.setItem(key, JSON.stringify(value)) }
  catch { throw new Error('Could not save on this device. No new request was sent; earlier requests remain saved.') }
}
async function locked(key, action) {
  if (!globalThis.navigator?.locks?.request) throw new Error('This browser cannot safely save requests across tabs. Open Concierge over HTTPS; saved results remain readable.')
  return navigator.locks.request(key, { mode: 'exclusive' }, async () => action())
}
export function readIdentity(storage) {
  const value = read(storage, MISSION_META, () => ({ accountId: null, label: '', draft: '' }))
  if (!object(value) || (value.accountId !== null && !identifier(value.accountId)) || typeof value.draft !== 'string') throw new Error('Saved account information could not be read. It has been preserved.')
  return value
}
export function readJournal(storage, account) {
  const value = read(storage, missionKey(account), empty)
  if (value.v !== 1 || typeof value.draft !== 'string' || !object(value.context) || !object(value.replies) || !Array.isArray(value.pending) || !Array.isArray(value.missions)) throw new Error('Saved Concierge requests could not be read. They have been preserved.')
  return value
}
export async function changeJournal(storage, account, change) {
  const key = missionKey(account)
  return locked(key, () => {
    const journal = readJournal(storage, account)
    const result = change(journal)
    write(storage, key, journal)
    return result
  })
}
export async function rememberIdentity(storage, identity) {
  missionKey(identity.accountId)
  return locked(MISSION_META, () => {
    const old = readIdentity(storage)
    // The anonymous draft belongs to first sign-in only; never move an
    // existing account's request to a newly selected Google account.
    const firstDraft = old.accountId === null ? old.draft : ''
    const submission = old.submission || null
    if (submission && !submission.accountId) submission.accountId = identity.accountId
    write(storage, MISSION_META, { accountId: identity.accountId, label: String(identity.email || identity.displayName || 'OS3 account'), draft: '', submission })
    return { draft: firstDraft, submission: submission?.accountId === identity.accountId ? submission : null }
  })
}
export async function stageSignInSubmission(storage, request, expectedAccount = readIdentity(storage).accountId) {
  return locked(MISSION_META, () => {
    const old = readIdentity(storage)
    if (old.accountId !== expectedAccount) throw new Error('The selected account changed before saving. Review the prompt in the account you want to use.')
    if (old.submission) {
      if (JSON.stringify(old.submission.request) !== JSON.stringify(request)) throw new Error('The earlier submitted request is still saved. Finish signing in for it first.')
      return old.submission
    }
    const submission = { key: crypto.randomUUID(), request: clone(request), accountId: old.accountId }
    write(storage, MISSION_META, { ...old, submission })
    return submission
  })
}
export async function clearSignInSubmission(storage, account, key) {
  return locked(MISSION_META, () => {
    const old = readIdentity(storage)
    if (old.submission?.accountId === account && old.submission.key === key) write(storage, MISSION_META, { ...old, submission: null })
  })
}
export async function saveMissionDraft(storage, account, draft) {
  if (typeof draft !== 'string' || draft.length > 4000) throw new Error('Keep the request within 4,000 characters.')
  if (account) return changeJournal(storage, account, (j) => { j.draft = draft })
  return locked(MISSION_META, () => {
    const old = readIdentity(storage)
    if (old.accountId !== null) throw new Error('The selected account changed. Your text is still in the prompt.')
    write(storage, MISSION_META, { ...old, draft })
  })
}

export function cleanContext(value = {}) {
  const out = {}
  for (const name of ['timezone', 'locale', 'partySize', 'location', 'preferences', 'customer', 'restaurants', 'savedPlaces']) {
    if (value[name] !== undefined) out[name] = clone(value[name])
  }
  if (JSON.stringify(out).length > 16000) throw new Error('There is too much saved context for one request. Choose a city or a smaller set of places.')
  return out
}
export function missionRequest(prompt, context = {}) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw new Error('Enter a request of up to 4,000 characters.')
  return { prompt: prompt.trim(), context: cleanContext(context) }
}
export async function queueIntent(storage, account, { path, body, kind, subject = 'new', key = crypto.randomUUID() }) {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key) || !['create', 'answer', 'cancel'].includes(kind)) throw new Error('Could not create a safe request.')
  const copy = clone(body)
  return changeJournal(storage, account, (j) => {
    const existing = j.pending.find((p) => p.kind === kind && p.subject === subject && !p.rejected)
    if (existing) {
      if (JSON.stringify(existing.body) !== JSON.stringify(copy)) throw new Error('An earlier request is still awaiting confirmation. It has been kept with its original instructions.')
      return clone(existing)
    }
    const intent = { key, path, body: copy, kind, subject, attempted: false, createdAt: Date.now() }
    j.pending.push(intent)
    if (kind === 'create' && j.draft.trim() === copy.prompt) j.draft = ''
    return clone(intent)
  })
}
export async function markAttempted(storage, account, key) {
  return changeJournal(storage, account, (j) => {
    const item = j.pending.find((p) => p.key === key)
    if (!item) return null
    item.attempted = true
    return clone(item)
  })
}

const pick = (value, fields) => Object.fromEntries(fields.filter((k) => value?.[k] !== undefined).map((k) => [k, clone(value[k])]))
export function publicMission(value) {
  if (!object(value) || !identifier(value.id) || !Number.isInteger(value.revision) || value.revision < 1 || !MISSION_STATES.includes(value.state) || typeof value.prompt !== 'string' || !Array.isArray(value.destinations) || !Array.isArray(value.needs)) throw new Error('OS3 returned an unreadable mission. The last saved result is kept.')
  const m = pick(value, ['id', 'revision', 'state', 'prompt', 'createdAt', 'updatedAt', 'error', 'discoveryNote', 'authority', 'limits'])
  m.context = cleanContext(value.context)
  m.needs = value.needs.map((n) => pick(n, ['id', 'field', 'question']))
  m.answers = (value.answers || []).map((a) => pick(a, ['questionId', 'answer']))
  const quotes = (entries = []) => entries.map((q) => pick(q, ['role', 't', 'text']))
  const evidence = (entries = []) => entries.map((e) => ({ ...pick(e, ['restaurant', 'source', 'callId', 'updatedAt', 'state', 'merchant']), quotes: quotes(e.quotes) }))
  m.answer = value.answer ? { ...pick(value.answer, ['text', 'generatedAt', 'uncertainty']), evidence: evidence(value.answer.evidence) } : null
  m.destinations = value.destinations.map((p) => ({
    ...pick(p, ['id', 'name', 'phone', 'locale', 'source', 'status']),
    attempts: (p.attempts || []).map((a) => ({ ...pick(a, ['createdAt']), call: a.call ? {
      ...pick(a.call, ['callId', 'state', 'merchant', 'summary', 'failure', 'updatedAt', 'reconciling']), evidence: quotes(a.call.evidence),
    } : null })),
  }))
  return m
}
function mergeSnapshot(j, value) {
  const m = publicMission(value)
  const old = j.missions.find((x) => x.id === m.id)
  if (old && old.revision >= m.revision) return
  const history = old?.history || []
  // Retain prior evidence, questions and outcomes instead of silently
  // replacing them when a later revision has less information.
  if (old) {
    const previous = { ...old }; delete previous.history
    history.push(previous)
  }
  const saved = { ...m, history }
  if (old) j.missions[j.missions.indexOf(old)] = saved
  else j.missions.push(saved)
  if (m.createdAt >= j.contextAt && Object.keys(m.context).length) {
    j.context = m.context
    j.contextAt = m.createdAt
  }
}
export async function saveSnapshots(storage, account, snapshots) {
  return changeJournal(storage, account, (j) => { snapshots.forEach((m) => mergeSnapshot(j, m)) })
}
export async function settleIntent(storage, account, key, snapshot) {
  return changeJournal(storage, account, (j) => {
    mergeSnapshot(j, snapshot)
    j.pending = j.pending.filter((p) => p.key !== key)
  })
}

export function isMissionPrompt(text) {
  if (/^https?:\/\/\S+$/i.test(text.trim())) return false
  return /[?？]/.test(text) || /\b(call|phone|ring|telephone|book|reserve|reservation|find|ask|check|research|recommend|availability|available|sold out|burger|tonight|tomorrow|near me|dinner|lunch)\b/i.test(text)
}
export function buildKnownContext({ previous = {}, items = [], city, geo, timezone } = {}) {
  const context = cleanContext(previous)
  if (timezone && !context.timezone) context.timezone = timezone
  if (city && city !== 'all') context.location = { city }
  else if (Number.isFinite(geo?.lat) && Number.isFinite(geo?.lng) && Date.now() - geo.observedAt < 600000) context.location = { latitude: geo.lat, longitude: geo.lng }
  // A saved place's city is a destination, not proof of the user's location.
  // Names and links remain references for server discovery, not dial targets.
  const selected = items.filter((p) => (!city || city === 'all' || p.city === city) && (p.category === 'eat' || ['food', 'beverage', 'wine'].includes(p.domain)))
  context.savedPlaces = selected.slice(0, 20).map((p) => ({ id: p.id, name: p.title, city: p.city, sourceUrls: [...new Set([p.website, p.url, p.mapsUrl].filter((url) => /^https?:\/\//i.test(url || '')))], notes: p.notes || '' }))
  return cleanContext(context)
}

export function canCallYourself(mission) {
  if (!['completed', 'canceled'].includes(mission.state)) return false
  return mission.destinations.every((p) => (p.attempts || []).every((a) => a.call && ['completed', 'failed', 'canceled'].includes(a.call.state)))
}
