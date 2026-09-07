import { test, expect } from '@playwright/test'
import { decodeVoice, VOICE_DEFAULT_ORIGIN } from '../../src/lib/voice.js'

const key = 'os3-concierge.voice.v1'
const nonce = 'test-browser-request-123456'
function envelope(kind = 'phrase') {
  const result = { v: 1, source: 'os3-voice', ref: 'desy', nonce, kind, generatedAt: new Date().toISOString() }
  if (kind === 'phrase') result.phrase = { locale: 'es-ES', target: '¿Os quedan cuatro hamburguesas? <img src=x onerror=alert(1)>', english: 'Do you have four burgers left?', pronunciation: ['txuleta: choo-LEH-tah'] }
  else result.call = { callId: 'call_browser_1', state: 'completed', merchant: { availability: 'unknown', reservation: 'unconfirmed' }, summary: 'Staff could not confirm a table.', evidence: [{ role: 'user', t: 18, text: 'No puedo confirmar.' }] }
  return result
}
async function pending(page, mode = 'speak', requestNonce = nonce) {
  await page.evaluate(({ key, nonce, mode, origin }) => {
    const value = JSON.parse(localStorage.getItem(key) || '{"v":1,"draft":{},"pending":[],"results":[]}')
    value.pending.push({ nonce, ref: 'desy', mode, label: 'BAR DESY', origin, createdAt: Date.now(), expiresAt: Date.now() + 86400000 })
    localStorage.setItem(key, JSON.stringify(value))
  }, { key, nonce: requestNonce, mode, origin: VOICE_DEFAULT_ORIGIN })
}
async function importReport(page, value) {
  await page.getByText('Import a result copied from OS3', { exact: true }).click()
  await page.getByLabel('Copied result').fill(JSON.stringify(value))
  await page.getByRole('button', { name: 'Save result', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.voicePlayback = []
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => [{ name: 'Spanish test voice', lang: 'es-ES' }],
      speak: (u) => window.voicePlayback.push(u.text),
      cancel: () => window.voicePlayback.push('STOP'),
    } })
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
  })
  await page.goto('./')
  await expect(page.locator('.tab[data-tab="voice"]')).toBeVisible()
})

test('place launch keeps existing navigation and passes bounded prefill to OS3', async ({ page }) => {
  const release = await page.request.get(new URL('version.json', page.url()).href)
  expect(release.ok()).toBe(true)
  expect(await release.json()).toMatchObject({ app: 'os3-concierge', sha: expect.stringMatching(/^(dev|[a-f0-9]{40})$/) })
  for (const label of ['List', 'Map', 'Plan', 'Voice']) await expect(page.getByRole('tab', { name: label })).toBeVisible()
  const card = page.locator('.card').first()
  const place = await card.locator('h3').textContent()
  await card.getByRole('button', { name: 'Speak or call with OS3' }).click()
  await expect(page.getByLabel('Restaurant', { exact: true })).toHaveValue(place)
  await page.getByLabel('What would you like to say or ask?').fill('Ask if four burgers remain at 20:15.')
  await page.getByLabel('Restaurant’s language').selectOption('es-ES')
  await expect(page.getByText('Voice release: OS3 staging.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'staging.os.unitary.com', exact: true })).toHaveAttribute('href', VOICE_DEFAULT_ORIGIN + '/')
  await page.route(VOICE_DEFAULT_ORIGIN + '/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>OS3 handoff test destination</p>' }))
  await page.getByRole('button', { name: 'Speak in OS3', exact: true }).click()
  await page.waitForURL(VOICE_DEFAULT_ORIGIN + '/**')
  const url = new URL(page.url())
  const request = decodeVoice(url.hash.slice('#voice='.length))
  expect(request.restaurant.name).toBe(place)
  expect(request.instruction).toContain('four burgers')
  expect(request.mode).toBe('speak')
  expect(request.return).toBe('https://bloklabs.github.io/os3-concierge/')
  expect(url.search).toBe('')
  await page.goBack()
  const requests = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).pending, key)
  expect(requests[0].origin).toBe(VOICE_DEFAULT_ORIGIN)
})

test('import, escaped text, device play/stop/replay and offline reload', async ({ page, context }) => {
  await page.getByRole('tab', { name: 'Voice' }).click()
  await pending(page)
  const value = envelope()
  await importReport(page, value)
  await expect(page.locator('#voiceStatus')).toHaveText('OS3 report saved on this device.')
  await expect(page.locator('.voice-target')).toHaveText(value.phrase.target)
  await expect(page.locator('.voice-result img')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'BAR DESY' })).toBeVisible()
  await page.getByRole('button', { name: 'Play device voice (fallback)', exact: true }).click()
  await expect(page.locator('#voiceStatus')).toHaveText('Playing device voice (fallback).')
  await page.getByRole('button', { name: 'Stop playback' }).click()
  await expect(page.locator('#voiceStatus')).toHaveText('Playback stopped.')
  await page.getByRole('button', { name: 'Play device voice (fallback)', exact: true }).click()
  expect(await page.evaluate(() => window.voicePlayback.filter((s) => s !== 'STOP').length)).toBe(2)
  await page.getByLabel('Copied result').fill(JSON.stringify(value))
  await page.getByRole('button', { name: 'Save result', exact: true }).click()
  await expect(page.locator('#voiceStatus')).toContainText('No matching voice request')
  await expect(page.locator('.voice-result')).toHaveCount(1)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('tab', { name: 'Voice' }).click()
  await expect(page.locator('.voice-target')).toHaveText(value.phrase.target)
  await expect(page.locator('#voiceNetwork')).toContainText('Offline')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('call completion remains unconfirmed and includes merchant evidence', async ({ page }) => {
  await page.getByRole('tab', { name: 'Voice' }).click()
  await pending(page, 'call')
  const report = envelope('call')
  report.call.evidence[0].t = null
  report.call.truncated = true
  await importReport(page, report)
  await expect(page.getByText('OS3 reported: reservation unconfirmed.', { exact: true })).toBeVisible()
  await expect(page.getByText('No puedo confirmar.', { exact: true })).toBeVisible()
  await expect(page.getByText('Restaurant · Time unavailable', { exact: true })).toBeVisible()
  await expect(page.getByText('OS3 shortened this report. Open OS3 for the full record.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View current call in OS3' })).toHaveAttribute('href', VOICE_DEFAULT_ORIGIN + '/#voice-call=call_browser_1')
  await expect(page.locator('.voice-result .voice-note').first()).toContainText('Call report from OS3 staging')
  await page.getByRole('button', { name: 'Delete this saved voice result' }).click()
  await expect(page.locator('.voice-result')).toHaveCount(0)
})

test('offline launch keeps the draft and creates no pending call', async ({ page, context }) => {
  await page.getByRole('tab', { name: 'Voice' }).click()
  await page.getByLabel('What would you like to say or ask?').fill('Ask for a table for four.')
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Call in OS3', exact: true }).click()
  await expect(page.locator('#voiceStatus')).toContainText('Connect to the internet')
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)
  expect(saved.draft.instruction).toBe('Ask for a table for four.')
  expect(saved.pending).toHaveLength(0)
})

for (const duplicate of [true, false]) {
  test(`two browser tabs preserve ${duplicate ? 'one-use replay protection' : 'both independent reports'}`, async ({ page, context }) => {
    await page.getByRole('tab', { name: 'Voice' }).click()
    await pending(page)
    const otherNonce = duplicate ? nonce : 'second-browser-request-12345'
    if (!duplicate) await pending(page, 'speak', otherNonce)
    const other = await context.newPage()
    await other.goto(page.url())
    await other.locator('.capture-input').waitFor()
    await other.getByRole('tab', { name: 'Voice' }).click()
    await Promise.all([
      importReport(page, envelope()),
      importReport(other, { ...envelope(), nonce: otherNonce }),
    ])
    await expect.poll(async () => {
      const a = await page.locator('#voiceStatus').textContent()
      const b = await other.locator('#voiceStatus').textContent()
      return [a, b].filter((s) => /report saved|No matching voice request/.test(s)).length
    }).toBe(2)
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)
    expect(saved.results).toHaveLength(duplicate ? 1 : 2)
    expect(saved.pending).toHaveLength(0)
  })
}
