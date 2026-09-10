import { MissionClient, renderGoogleSignIn } from './mission-client.js'
import {
  MISSION_META, MISSION_PREFIX, readIdentity, readJournal, rememberIdentity,
  saveMissionDraft, missionRequest, queueIntent, markAttempted, settleIntent,
  saveSnapshots, stageSignInSubmission, clearSignInSubmission, terminalMission,
  changeJournal,
} from './mission-store.js'

export class MissionController {
  constructor({ storage, client = new MissionClient(), context = () => ({}), online = () => navigator.onLine !== false } = {}) {
    try { this.storage = storage || globalThis.localStorage }
    catch { this.storage = { getItem() { throw new Error('Device storage is unavailable.') } } }
    this.client = client
    this.context = context
    this.online = online
    this.listeners = new Set()
    this.notice = ''
    this.authWanted = false
    this.authVersion = 0
    this.authFlight = null
    this.authRetryAt = 0
    this.challenge = null
    this.syncFlight = null
    this.config = null
    this.timer = null
    this.signInHost = null
    this.onStorage = (e) => {
      if (e.key !== MISSION_META && !e.key?.startsWith(MISSION_PREFIX)) return
      try {
        const account = readIdentity(this.storage).accountId
        if (this.client.identity && this.client.identity.accountId !== account) this.signOut(false)
      } catch (error) { this.notice = error.message }
      this.emit()
    }
    this.onResume = () => { this.emit(); this.tick() }
  }
  start() {
    globalThis.addEventListener?.('storage', this.onStorage)
    globalThis.addEventListener?.('online', this.onResume)
    globalThis.addEventListener?.('offline', this.onResume)
    globalThis.document?.addEventListener('visibilitychange', this.onResume)
    this.tick()
  }
  stop() {
    clearTimeout(this.timer)
    globalThis.removeEventListener?.('storage', this.onStorage)
    globalThis.removeEventListener?.('online', this.onResume)
    globalThis.removeEventListener?.('offline', this.onResume)
    globalThis.document?.removeEventListener('visibilitychange', this.onResume)
    this.signOut(false)
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  emit() { for (const fn of this.listeners) fn() }
  state() {
    try {
      const identity = readIdentity(this.storage)
      const journal = identity.accountId ? readJournal(this.storage, identity.accountId) : { draft: identity.draft, context: {}, pending: [], missions: [], replies: {} }
      return { identity, journal, authenticated: this.client.identity?.accountId === identity.accountId && !!identity.accountId, online: this.online(), notice: this.notice, config: this.config }
    } catch (error) { return { error: error.message, online: this.online(), notice: this.notice } }
  }
  async saveDraft(value) {
    try { await saveMissionDraft(this.storage, readIdentity(this.storage).accountId, value) }
    catch (error) { this.notice = error.message; this.emit(); throw error }
  }
  async submit(prompt) {
    const identity = readIdentity(this.storage)
    const previous = identity.accountId ? readJournal(this.storage, identity.accountId).context : {}
    const request = missionRequest(prompt, this.context(previous))
    if (identity.accountId) await queueIntent(this.storage, identity.accountId, { kind: 'create', path: '/missions', body: request })
    else await stageSignInSubmission(this.storage, request)
    this.notice = this.online() ? 'Request saved. Concierge will work within your instructions.' : 'Saved on this device. Waiting for reconnect; no new call has been sent.'
    this.authWanted = true
    this.emit()
    void this.sync()
  }
  async acceptIdentity(identity) {
    const transfer = await rememberIdentity(this.storage, identity)
    if (transfer.draft) await saveMissionDraft(this.storage, identity.accountId, transfer.draft)
    if (transfer.submission) {
      await queueIntent(this.storage, identity.accountId, { kind: 'create', path: '/missions', body: transfer.submission.request, key: transfer.submission.key })
      await clearSignInSubmission(this.storage, identity.accountId, transfer.submission.key)
    }
    this.notice = 'Signed in. Checking your saved requests.'
    this.authWanted = false
    this.challenge = null
    this.signInHost?.replaceChildren()
    this.emit()
    void this.sync()
  }
  signOut(notify = true) {
    this.authVersion++
    this.client.forget()
    this.challenge = null
    this.config = null
    this.authWanted = false
    globalThis.google?.accounts?.id?.disableAutoSelect?.()
    this.signInHost?.replaceChildren()
    if (notify) { this.notice = 'Signed out. Saved results stay on this device.'; this.emit() }
  }
  async signIn(host, force = false) {
    this.signInHost = host
    if (!this.online() || this.authFlight) return
    if (this.client.identity) return this.acceptIdentity(this.client.identity).catch((error) => { this.notice = error.message; this.emit() })
    if (force) this.authRetryAt = 0
    if (this.authRetryAt > Date.now()) return
    if (!force && this.challenge?.expiresAt > Date.now() && host.childElementCount) return
    const version = ++this.authVersion
    this.authWanted = true
    this.notice = 'Sign in with Google to run or update your saved request.'
    this.authFlight = renderGoogleSignIn(host, this.client, {
      current: () => this.authVersion === version,
      onIdentity: (identity) => this.acceptIdentity(identity),
      onError: (error) => { this.challenge = null; this.authWanted = false; this.authRetryAt = Date.now() + 60000; host.replaceChildren(); this.notice = error.message; this.emit() },
    }).then((challenge) => { if (version === this.authVersion) this.challenge = challenge }).catch((error) => {
      if (version === this.authVersion) { this.notice = error.message; this.authWanted = false; this.authRetryAt = Date.now() + 60000 }
    }).finally(() => { this.authFlight = null; this.emit() })
    this.emit()
    return this.authFlight
  }
  async answer(mission, question, answer) {
    const account = readIdentity(this.storage).accountId
    if (!account || !answer.trim() || answer.length > 2000) throw new Error('Enter an answer of up to 2,000 characters.')
    await queueIntent(this.storage, account, { kind: 'answer', subject: mission.id + '/' + question.id, path: '/missions/' + mission.id + '/answers', body: { questionId: question.id, expectedRevision: mission.revision, answer } })
    this.notice = this.online() ? 'Answer saved for this question.' : 'Answer saved on this device; waiting to reconnect.'
    this.authWanted = true; this.emit(); void this.sync()
  }
  async saveReply(missionId, questionId, text) {
    const account = readIdentity(this.storage).accountId
    if (!account) return
    await changeJournal(this.storage, account, (j) => { j.replies[missionId + '/' + questionId] = text })
  }
  async cancel(mission) {
    const account = readIdentity(this.storage).accountId
    await queueIntent(this.storage, account, { kind: 'cancel', subject: mission.id, path: '/missions/' + mission.id + '/cancel', body: {} })
    this.notice = this.online() ? 'Stop requested. Awaiting OS3 and carrier confirmation.' : 'Stop requested on this device. Reconnect to send it; the existing mission may still be running.'
    this.authWanted = true; this.emit(); void this.sync()
  }
  async sync() {
    if (this.syncFlight || !this.online()) return this.syncFlight
    const identity = this.client.identity
    if (!identity) { this.emit(); return }
    if (readIdentity(this.storage).accountId !== identity.accountId) return
    const version = this.authVersion
    const current = () => this.authVersion === version && this.client.identity?.accountId === identity.accountId
    this.syncFlight = (async () => {
      try {
        const staged = readIdentity(this.storage).submission
        if (staged?.accountId === identity.accountId) {
          await queueIntent(this.storage, identity.accountId, { kind: 'create', path: '/missions', body: staged.request, key: staged.key })
          await clearSignInSubmission(this.storage, identity.accountId, staged.key)
        }
        let dispatchError = ''
        const work = async () => {
          // Stop intents take precedence; a stale answer must never starve a stop.
          const pending = readJournal(this.storage, identity.accountId).pending
            .filter((p) => !p.rejected).sort((a, b) => Number(b.kind === 'cancel') - Number(a.kind === 'cancel'))
          for (const saved of pending) {
            if (!current()) return
            const intent = await markAttempted(this.storage, identity.accountId, saved.key)
            if (!intent || !current()) continue
            try {
              const result = await this.client.request(intent.path, { body: intent.body, key: intent.key })
              // Delayed responses always belong to the issuing account.
              await settleIntent(this.storage, identity.accountId, intent.key, result.mission)
              if (current()) { this.notice = dispatchError; this.emit() }
            } catch (error) {
              if (error.status === 401) throw error
              if ([400, 409].includes(error.status)) await changeJournal(this.storage, identity.accountId, (j) => {
                const item = j.pending.find((p) => p.key === intent.key)
                if (item) item.rejected = error.status
              })
              dispatchError = error.message
              if (current()) { this.notice = dispatchError; this.emit() }
            }
          }
        }
        if (!navigator.locks?.request) throw new Error('Cross-tab request locking is unavailable. Saved requests are kept.')
        await navigator.locks.request(MISSION_PREFIX + identity.accountId + '.dispatch', { ifAvailable: true }, (lock) => lock ? work() : undefined)
        if (!current()) return
        const results = await this.client.request('/missions')
        if (!Array.isArray(results.missions)) throw new Error('OS3 returned unreadable results. Saved outcomes are kept.')
        await saveSnapshots(this.storage, identity.accountId, results.missions)
        if (!current()) return
        if (!this.config) this.config = await this.client.request('/config')
        this.emit()
      } catch (error) {
        if (!current()) return
        if (error.status === 401) { this.client.forget(); this.challenge = null; this.authWanted = true }
        this.notice = error.message
        this.emit()
      }
    })().finally(() => { this.syncFlight = null; if (this.authVersion !== version && this.client.identity) void this.sync() })
    return this.syncFlight
  }
  tick() {
    clearTimeout(this.timer)
    const state = this.state()
    if (state.journal && document.visibilityState !== 'hidden') {
      const active = state.identity.submission || state.journal.pending.some((p) => !p.rejected) || state.journal.missions.some((m) => !terminalMission(m))
      if (active && this.online()) {
        if (!state.authenticated && this.authRetryAt <= Date.now()) { this.authWanted = true; this.emit() }
        else void this.sync()
      }
    }
    this.timer = setTimeout(() => this.tick(), 5000)
  }
}
