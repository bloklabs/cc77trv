// CDP-driven smoke test: launches headless Chrome, loads the app, waits for the
// SPA to render, captures console errors + rendered DOM, optionally exercises
// the Add flow, and screenshots. Uses Node's built-in WebSocket/fetch (no deps).
//
// Usage: node tools/cdp_smoke.mjs <url> [--shot out.png]
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/snap/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean).find(existsSync)
const url = process.argv[2]
const shot = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null
if (!url) { console.error('usage: cdp_smoke.mjs <url> [--shot out.png]'); process.exit(2) }
if (!CHROME) { console.error('Chrome/Chromium not found; set CHROME_PATH'); process.exit(2) }

const PORT = 9222 + Math.floor(Math.random() * 500)
const profile = mkdtempSync(join(tmpdir(), 'os3-concierge-cdp-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
  '--disable-crash-reporter', '--disable-crashpad', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--window-size=430,900',
], { stdio: ['ignore', 'ignore', 'pipe'] })
let chromeError = ''
chrome.stderr.on('data', (chunk) => { chromeError += chunk })

function finish(code) {
  chrome.kill('SIGKILL')
  rmSync(profile, { recursive: true, force: true })
  process.exit(code)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getPageWsUrl() {
  for (let i = 0; i < 50; i++) {
    if (chrome.exitCode != null || chrome.signalCode != null) {
      throw new Error(`Chrome exited before CDP was ready: ${chromeError.trim() || chrome.exitCode || chrome.signalCode}`)
    }
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch { /* not up yet */ }
    await sleep(200)
  }
  throw new Error(`Chrome CDP did not come up${chromeError ? `: ${chromeError.trim()}` : ''}`)
}

function cdp(ws) {
  let id = 0
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    else if (msg.method) events.push(msg)
  })
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const mid = ++id
      pending.set(mid, resolve)
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }))
    })
  return { send, events }
}

async function main() {
  const wsUrl = await getPageWsUrl()
  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
  const { send } = cdp(ws)

  // Talk to the page target directly (no session multiplexing).
  const S = (m, p) => send(m, p)
  await S('Page.enable')
  await S('Runtime.enable')
  await S('Log.enable')

  const jsExceptions = []   // uncaught JS — fatal
  const resourceWarnings = [] // network/resource errors — non-fatal noise
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      jsExceptions.push(d.exception?.description || d.text || 'exception')
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      resourceWarnings.push(msg.params.entry.text)
    }
  })

  await S('Page.navigate', { url })
  await sleep(3500) // let module boot + render list

  // Exercise (best-effort; only resolves on the dev server where /src is served):
  // add an item through the real save path and confirm it persists + normalizes.
  const exercise = `(async () => {
    try {
      const base = new URL('.', location.href).href
      const s = await import(base + 'src/lib/store.js')
      const { parseBulk } = await import(base + 'src/lib/bulk.js')
      const saved = await s.saveItem({ title: 'Test Ramen', category: 'eat', city: 'Tokyo', costRaw: '$18', notes: 'smoke' })
      // bulk email paste → many entries
      const cands = parseBulk('For Paris\\n- Septime\\n- Motors Espresso\\n- Le Bon Georges')
      const madeIds = []
      for (const c of cands) { const r = await s.saveItem({ title: c.title, city: c.city }); madeIds.push(r.id) }
      const items = await s.allItems()
      const septime = items.find((i) => i.title === 'Septime')
      const b = await import(base + 'src/lib/blurb.js')
      const blurb = b.itemBlurb(saved)
      await s.deleteItem(saved.id)
      for (const id of madeIds) await s.deleteItem(id)
      return { ok: true, count: items.length, lat: saved.lat, blurbHasTokyo: blurb.includes('Tokyo'),
        bulkParsed: cands.length, septimeTier: septime && septime.booking && septime.booking.tier,
        septimeMaps: !!(septime && septime.mapsUrl) }
    } catch (e) { return { ok: false, skipped: String(e.message || e) } }
  })()`
  const evalRes = await S('Runtime.evaluate', { expression: exercise, awaitPromise: true, returnByValue: true })
  const exResult = evalRes.result?.result?.value ?? evalRes.result?.value ?? null

  const domRes = await S('Runtime.evaluate', { expression: 'document.body.textContent', returnByValue: true })
  const bodyText = domRes.result?.result?.value ?? domRes.result?.value ?? ''

  if (shot) {
    const cap = await S('Page.captureScreenshot', { format: 'png' })
    if (cap.result?.data) writeFileSync(shot, Buffer.from(cap.result.data, 'base64'))
  }

  const markers = ['OS3 Concierge', 'List', 'Map', 'Plan']
  const missing = markers.filter((m) => !bodyText.includes(m))
  const booted = /Paste a link|Nothing here yet|Noble Rot|Test Ramen|Filter/.test(bodyText)
  const fatalJs = jsExceptions.filter((e) => !/favicon|manifest|sw\.js|ServiceWorker|tile\.openstreetmap|allorigins|jina|net::ERR/i.test(e))

  console.log('URL:', url)
  console.log('body chars:', bodyText.length)
  console.log('markers missing:', missing)
  console.log('booted+rendered:', booted)
  console.log('exercise result:', JSON.stringify(exResult))
  console.log('fatal JS exceptions:', fatalJs.length, fatalJs.slice(0, 5))
  console.log('resource warnings (non-fatal):', resourceWarnings.length)
  if (shot) console.log('screenshot:', shot)

  const ok = missing.length === 0 && booted && fatalJs.length === 0
  console.log('RESULT:', ok ? 'PASS' : 'FAIL')
  finish(ok ? 0 : 1)
}

main().catch((e) => { console.error('smoke error:', e.message); finish(1) })
