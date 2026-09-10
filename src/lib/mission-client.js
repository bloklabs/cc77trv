import { os3Origin } from './voice.js'

export class MissionApiError extends Error {
  constructor(status, kind) {
    super(status === 401 ? 'Sign in to update this request.' : status === 403 ? 'This account or site cannot access that request.' : status === 409 ? 'OS3 has a newer or different request. Your saved instructions are kept.' : status === 0 ? 'Connection interrupted. Your exact request is saved for reconnect.' : status === 503 ? 'OS3 mission service is not configured yet. Your request is saved.' : 'OS3 could not finish this update. Your saved request is kept.')
    this.status = status
    this.kind = kind
  }
}

export class MissionClient {
  #session = null
  constructor({ origin, fetcher = (...args) => globalThis.fetch(...args), now = () => Date.now() } = {}) {
    this.origin = os3Origin(origin)
    this.fetcher = fetcher
    this.now = now
  }
  get identity() {
    const s = this.#session
    return s && s.expiresAt * 1000 > this.now() + 5000 ? { accountId: s.accountId, email: s.email, displayName: s.displayName } : null
  }
  forget() { this.#session = null }
  async request(path, { body, key, anonymous = false, signal } = {}) {
    if (!/^\/(?:auth\/(?:challenge|exchange)|config|missions(?:\/[A-Za-z0-9_-]+(?:\/(?:answers|cancel))?)?)$/.test(path)) throw new Error('Unsupported Concierge request.')
    const session = this.#session
    if (!anonymous && !this.identity) throw new MissionApiError(401, 'unauthenticated')
    let response
    try {
      response = await this.fetcher(this.origin + '/v1/concierge' + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store',
        redirect: 'error', signal: signal || AbortSignal.timeout(25000),
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(anonymous ? {} : { Authorization: 'Bearer ' + session.accessToken, 'X-OS3-Account': session.accountId }),
          ...(key ? { 'Idempotency-Key': key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch { throw new MissionApiError(0, 'network') }
    if (!response.ok) throw new MissionApiError(response.status, 'request_failed')
    let value
    try {
      const raw = await response.text()
      if (raw.length > 2000000) throw new Error()
      value = JSON.parse(raw)
    } catch { throw new MissionApiError(0, 'unreadable_response') }
    return value
  }
  challenge() { return this.request('/auth/challenge', { anonymous: true, body: {} }) }
  async exchange(challengeId, credential, current = () => true) {
    const value = await this.request('/auth/exchange', { anonymous: true, body: { challengeId, credential } })
    if (value.scope !== 'concierge:missions' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.accountId || '') || typeof value.accessToken !== 'string' || !value.accessToken || !Number.isFinite(value.expiresAt) || value.expiresAt * 1000 <= this.now()) throw new Error('OS3 did not return a valid mission sign-in.')
    if (!current()) return null
    this.#session = value
    return this.identity
  }
}

let googleLoader
export async function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.id) return google.accounts.id
  if (!googleLoader) googleLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    const timeout = setTimeout(() => failed(), 15000)
    const failed = () => { clearTimeout(timeout); script.remove(); googleLoader = null; reject(new Error('Google sign-in could not load. Your request is saved.')) }
    script.onerror = failed
    script.onload = () => {
      clearTimeout(timeout)
      if (globalThis.google?.accounts?.id) resolve(google.accounts.id)
      else failed()
    }
    document.head.append(script)
  })
  return googleLoader
}

// Google's popup owns credential entry. This app never asks for copied keys.
export async function renderGoogleSignIn(host, client, { onIdentity, onError, current = () => true } = {}) {
  const [challenge, googleId] = await Promise.all([client.challenge(), loadGoogleIdentity()])
  if (!current() || !host.isConnected) return null
  if (typeof challenge.challengeId !== 'string' || typeof challenge.nonce !== 'string' || !challenge.nonce || typeof challenge.clientId !== 'string' || challenge.expiresIn !== 300) throw new Error('OS3 sign-in challenge is unavailable. Your request is saved.')
  let used = false
  googleId.initialize({ client_id: challenge.clientId, nonce: challenge.nonce, auto_select: true, use_fedcm_for_prompt: true,
    callback: async (result) => {
      if (used || !current()) return
      used = true
      try {
        const identity = await client.exchange(challenge.challengeId, result.credential, current)
        if (current() && identity) await onIdentity(identity)
      } catch (error) { if (current()) onError(error) }
    },
  })
  host.replaceChildren()
  googleId.renderButton(host, { theme: 'outline', size: 'large', width: Math.min(320, host.clientWidth || 280) })
  googleId.prompt()
  return { expiresAt: Date.now() + challenge.expiresIn * 1000 }
}
