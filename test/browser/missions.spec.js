import { test, expect } from '@playwright/test'

const ORIGIN = 'https://staging.os.unitary.com'
const META = 'os3-concierge.missions.identity.v1'
const PREFIX = 'os3-concierge.missions.v1.'
const prompt = 'Call three restaurants near me, check vegetarian dinner for four tonight, and report back.'
const context = { location: { city: 'San Sebastián' }, timezone: 'Europe/Madrid', locale: 'es-ES', preferences: { diet: 'vegetarian' }, partySize: 4 }
const snapshot = (changes = {}) => ({ id: 'mission_browser', revision: 1, state: 'queued', prompt, context, createdAt: Date.now() / 1000, updatedAt: Date.now() / 1000, destinations: [], needs: [], answer: null, authority: { commitment: 'information_only', maxBookings: 0 }, ...changes })
const destination = (name, state = 'dialing') => ({ id: name.toLowerCase(), name, phone: '+34943000000', source: { url: 'https://example.org/' + name, checkedAt: '2026-09-10T10:00:00Z' }, attempts: [{ call: { callId: 'call_' + name, state, merchant: { availability: 'unknown', reservation: 'not_requested' }, evidence: [], summary: null } }] })

async function setup(page, { lostCreate = false, anonymous = false } = {}) {
  const api = { current: null, posts: [], answers: [], cancellations: 0, challenges: 0, exchanges: [], hold: null }
  await page.addInitScript(({ META, PREFIX, context, anonymous }) => {
    if (!anonymous && !localStorage.getItem(META)) {
      localStorage.setItem(META, JSON.stringify({ accountId: 'accountA', label: 'a@example.test', draft: '' }))
      localStorage.setItem(PREFIX + 'accountA', JSON.stringify({ v: 1, draft: '', context, contextAt: 0, missions: [], pending: [], replies: {} }))
    }
    window.__nextAccount = 'accountA'
    window.google = { accounts: { id: {
      initialize(config) { window.__gsi = config },
      renderButton(host) { const button = document.createElement('button'); button.textContent = 'Google test account'; button.onclick = () => window.__gsi.callback({ credential: 'google-credential-' + window.__nextAccount }); host.append(button) },
      prompt() {}, disableAutoSelect() {},
    } } }
  }, { META, PREFIX, context, anonymous })
  await page.route(ORIGIN + '/v1/concierge/**', async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname.replace('/v1/concierge', '')
    const headers = { 'Access-Control-Allow-Origin': req.headers().origin || new URL(page.url()).origin, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-OS3-Account, Idempotency-Key', 'Cache-Control': 'no-store' }
    const reply = (json, status = 200) => route.fulfill({ status, headers, json })
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    if (path === '/auth/challenge') { api.challenges++; return reply({ challengeId: 'challenge-' + api.challenges, nonce: 'nonce-' + api.challenges, clientId: 'test.apps.googleusercontent.com', expiresIn: 300 }) }
    if (path === '/auth/exchange') {
      api.exchanges.push(req.postDataJSON())
      const accountId = req.postDataJSON().credential.endsWith('accountB') ? 'accountB' : 'accountA'
      return reply({ accountId, email: accountId === 'accountA' ? 'a@example.test' : 'b@example.test', accessToken: 'mission-bearer-' + accountId, expiresAt: Date.now() / 1000 + 600, scope: 'concierge:missions' })
    }
    expect(req.headers()['x-os3-account']).toMatch(/^account[AB]$/)
    expect(req.headers().authorization).toBe('Bearer mission-bearer-' + req.headers()['x-os3-account'])
    expect(req.headers().cookie).toBeUndefined()
    if (path === '/config') return reply({ planning: 'anthropic', voice: { calls: 'elevenlabs' }, questions: 'live', discovery: 'openstreetmap' })
    if (path === '/missions' && req.method() === 'POST') {
      api.posts.push({ key: req.headers()['idempotency-key'], body: req.postDataJSON(), account: req.headers()['x-os3-account'] })
      api.current ||= snapshot({ prompt: req.postDataJSON().prompt, context: req.postDataJSON().context })
      if (api.hold) await api.hold
      if (lostCreate && api.posts.length === 1) return route.abort('connectionreset')
      return reply({ mission: api.current }, 202)
    }
    if (path.endsWith('/answers')) {
      api.answers.push(req.postDataJSON()); api.current = { ...api.current, revision: api.current.revision + 1, state: 'waiting', needs: [] }
      return reply({ mission: api.current })
    }
    if (path.endsWith('/cancel')) {
      api.cancellations++; api.current = { ...api.current, revision: api.current.revision + 1, state: 'canceling' }
      return reply({ mission: api.current })
    }
    if (path === '/missions') return reply({ missions: req.headers()['x-os3-account'] === 'accountB' ? [] : api.current ? [api.current] : [] })
    return reply({ error: 'test_unexpected_route' }, 404)
  })
  await page.goto('./')
  await expect(page.locator('#cap')).toBeVisible()
  return api
}
async function send(page, value = prompt) {
  await page.getByLabel('Ask Concierge or save a place').fill(value)
  await page.getByLabel('Ask Concierge or save a place').press('Enter')
}
async function signIn(page) {
  await page.getByRole('button', { name: 'Google test account', exact: true }).click()
  await expect(page.locator('[data-account]')).toContainText('Signed in')
}

test('one normal prompt reuses location/preferences, signs in with nonce, discovers sourced results inline', async ({ page }) => {
  const api = await setup(page)
  await send(page)
  await expect(page.getByRole('button', { name: 'Google test account' })).toBeVisible()
  expect(api.posts).toHaveLength(0)
  expect(await page.evaluate(() => window.__gsi.nonce)).toBe('nonce-1')
  await signIn(page)
  await expect(page.locator('[data-mission]')).toHaveCount(1)
  expect(api.posts).toHaveLength(1)
  expect(api.posts[0].body).toMatchObject({ prompt, context })
  expect(api.posts[0].body.context.restaurants).toBeUndefined()
  expect(api.exchanges[0]).toEqual({ challengeId: 'challenge-1', credential: 'google-credential-accountA' })
  api.current = snapshot({ revision: 2, state: 'speaking', destinations: ['A', 'B', 'C'].map((n) => destination(n)) })
  await page.getByRole('button', { name: 'Refresh results' }).click()
  await expect(page.locator('.mission-destination')).toHaveCount(3)
  await expect(page.getByText('Speaking with the restaurant', { exact: true })).toBeVisible()
  expect(page.url()).not.toContain('staging.os.unitary.com')
  await expect(page.getByRole('button', { name: 'Confirm and dial' })).toHaveCount(0)
  await expect(page.getByLabel('Restaurant’s language')).toHaveCount(0)
  const persisted = await page.evaluate(() => JSON.stringify(localStorage))
  expect(persisted).not.toContain('mission-bearer-'); expect(persisted).not.toContain('google-credential-')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('anonymous submission survives reload before sign-in without sending typed-but-unsubmitted drafts', async ({ page }) => {
  const api = await setup(page, { anonymous: true })
  await send(page, 'Call three vegetarian restaurants in San Sebastián in Spanish and report back.')
  // Reload after the user-visible durable acknowledgement, before Google sign-in.
  await expect(page.locator('[data-pending]')).toContainText('Saved on this device')
  await page.reload()
  await signIn(page)
  await expect(page.locator('[data-mission]')).toHaveCount(1)
  expect(api.posts).toHaveLength(1)
  await page.getByLabel('Ask Concierge or save a place').fill('A new unsent question')
  await page.reload()
  await expect(page.getByLabel('Ask Concierge or save a place')).toHaveValue('A new unsent question')
  expect(api.posts).toHaveLength(1)
})

test('lost create response and reload retry the exact key and prompt', async ({ page }) => {
  const api = await setup(page, { lostCreate: true })
  await send(page); await signIn(page)
  await expect(page.locator('[data-notice]')).toContainText('Connection interrupted')
  await page.reload(); await signIn(page)
  await expect(page.locator('[data-mission]')).toHaveCount(1)
  expect(api.posts).toHaveLength(2)
  expect(api.posts[0]).toEqual(api.posts[1])
})

test('staff answer keeps focus across status refresh; offline stop preserves partial evidence', async ({ page, context: browser }) => {
  const api = await setup(page); await send(page); await signIn(page)
  await expect(page.locator('[data-mission]')).toHaveCount(1)
  const place = destination('Desy', 'connected')
  place.attempts[0].call.evidence = [{ role: 'user', t: null, text: '<img src=x onerror=alert(1)> Two tables might be free.' }]
  api.current = snapshot({ revision: 2, state: 'needs_input', destinations: [place], needs: [{ id: 'q_staff', field: 'staff', question: 'What name should I give the restaurant?' }] })
  await page.getByRole('button', { name: 'Refresh results' }).click()
  const answer = page.getByLabel('What name should I give the restaurant?')
  await answer.fill('Jay')
  await answer.focus()
  api.current = { ...api.current, revision: 3 }
  await expect(page.locator('[data-mission]')).toHaveAttribute('data-revision', '3', { timeout: 10000 })
  await expect(answer).toHaveValue('Jay')
  await expect(answer).toBeFocused()
  await page.getByRole('button', { name: 'Send answer' }).click()
  await expect(page.getByText('Waiting for evidence', { exact: true })).toBeVisible()
  expect(api.answers).toEqual([{ questionId: 'q_staff', expectedRevision: 3, answer: 'Jay' }])
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await browser.setOffline(true)
  await page.getByRole('button', { name: 'Stop this request' }).click()
  await expect(page.locator('[data-local]')).toContainText('Stop saved on this device')
  expect(api.cancellations).toBe(0)
  await page.reload()
  await expect(page.locator('[data-network]')).toContainText('Offline')
  await expect(page.locator('[data-local]')).toContainText('may still be running')
  await expect(page.locator('[data-outcome] blockquote')).toContainText('Two tables might be free.')
  await expect(page.locator('[data-outcome] blockquote span')).toHaveText('Restaurant · Time unavailable')
  await expect(page.locator('.mission-card img')).toHaveCount(0)
  await browser.setOffline(false); await signIn(page)
  await expect(page.getByText('Stop requested — awaiting confirmation', { exact: true })).toBeVisible()
  expect(api.cancellations).toBe(1); expect(api.posts).toHaveLength(1)
  await expect(page.locator('[data-takeover] a[href^="tel:"]')).toHaveCount(0)
  api.current = { ...api.current, revision: api.current.revision + 1, state: 'canceled' }
  api.current.destinations[0].attempts[0].call.state = 'canceled'
  await page.getByRole('button', { name: 'Refresh results' }).click()
  await expect(page.getByRole('link', { name: 'Call Desy yourself' })).toHaveAttribute('href', 'tel:+34943000000')
})

test('storage refusal prevents any mission dispatch and preserves the typed prompt', async ({ page }) => {
  const api = await setup(page)
  await page.evaluate((prefix) => {
    const write = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) { if (key.startsWith(prefix)) throw new DOMException('quota', 'QuotaExceededError'); return write.call(this, key, value) }
  }, PREFIX)
  await send(page)
  await expect(page.locator('[data-notice]')).toContainText('Could not save')
  await expect(page.getByLabel('Ask Concierge or save a place')).toHaveValue(prompt)
  expect(api.posts).toHaveLength(0)
})

test('account switch during delayed create never displays account A result in account B', async ({ page }) => {
  const api = await setup(page)
  let release
  api.hold = new Promise((resolve) => { release = resolve })
  await send(page); await signIn(page)
  await expect.poll(() => api.posts.length).toBe(1)
  await page.getByRole('button', { name: 'Switch account' }).click()
  await page.evaluate(() => { window.__nextAccount = 'accountB' })
  await signIn(page)
  await expect(page.locator('[data-account]')).toContainText('b@example.test')
  release(); api.hold = null
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).missions.length, PREFIX + 'accountA')).toBe(1)
  await expect(page.locator('[data-mission]')).toHaveCount(0)
  expect(api.posts).toHaveLength(1)
})

test('concurrent phone tabs dispatch one saved mission under a browser lock', async ({ page, context: browser }) => {
  const a = await setup(page)
  const second = await browser.newPage()
  const b = await setup(second)
  for (const tab of [page, second]) {
    await tab.getByRole('button', { name: 'Sign in with Google', exact: true }).click()
    await signIn(tab)
  }
  let release
  const held = new Promise((resolve) => { release = resolve })
  a.hold = held; b.hold = held
  try {
    await Promise.all([send(page), send(second)])
    await expect.poll(() => a.posts.length + b.posts.length).toBe(1)
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).pending.length, PREFIX + 'accountA')).toBe(1)
  } finally { release() }
  await expect(page.locator('[data-mission]')).toHaveCount(1)
  await expect(second.locator('[data-mission]')).toHaveCount(1)
  expect(a.posts.length + b.posts.length).toBe(1)
})

test('normal prompt keeps its original account while waiting for a cross-tab storage lock', async ({ page, context: browser }) => {
  const api = await setup(page)
  await page.evaluate((key) => {
    const held = new Promise((resolve) => { window.__releaseJournal = resolve })
    void navigator.locks.request(key, async () => { window.__journalLocked = true; await held })
  }, PREFIX + 'accountA')
  await expect.poll(() => page.evaluate(() => !!window.__journalLocked)).toBe(true)
  const second = await browser.newPage()
  await second.goto('./')
  try {
    await send(page)
    await second.evaluate(({ META, PREFIX }) => {
      localStorage.setItem(PREFIX + 'accountB', JSON.stringify({ v: 1, draft: 'B private draft', context: {}, contextAt: 0, missions: [], pending: [], replies: {} }))
      localStorage.setItem(META, JSON.stringify({ accountId: 'accountB', label: 'b@example.test', draft: '' }))
    }, { META, PREFIX })
    await expect(page.locator('[data-account]')).toContainText('b@example.test')
  } finally { await page.evaluate(() => window.__releaseJournal()) }
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).pending.length, PREFIX + 'accountA')).toBe(1)
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).pending.length, PREFIX + 'accountB')).toBe(0)
  await expect(page.getByLabel('Ask Concierge or save a place')).toHaveValue('B private draft')
  expect(api.posts).toHaveLength(0)
})
