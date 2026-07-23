// Zero-token shared sync. Two people share a "space": a jsonblob.com blob id
// (the address) + a passphrase (the secret). The wishlist is end-to-end
// encrypted with AES-GCM using a key derived from the passphrase, so the blob
// host only ever stores ciphertext. Local-first: the app works offline and
// reconciles with the blob via last-write-wins + tombstones.

const SYNC_BASE = 'https://jsonblob.com/api/jsonBlob'
const SALT = 'wander-cc77-v1'
const PBKDF2_ITERS = 100000

function subtle() {
  const c = globalThis.crypto
  if (!c || !c.subtle) throw new Error('WebCrypto unavailable')
  return c.subtle
}

/** Derive an AES-GCM key from the space passphrase. */
export async function deriveKey(passphrase) {
  const enc = new TextEncoder()
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: enc.encode(SALT), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** Encrypt a JSON-able object → base64 string (iv prepended). */
export async function encryptPayload(key, obj) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(obj))
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, data))
  const packed = new Uint8Array(iv.length + ct.length)
  packed.set(iv, 0)
  packed.set(ct, iv.length)
  return toB64(packed)
}

/** Decrypt a base64 string produced by encryptPayload. */
export async function decryptPayload(key, b64) {
  const packed = fromB64(b64)
  const iv = packed.slice(0, 12)
  const ct = packed.slice(12)
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv }, key, ct)
  return JSON.parse(new TextDecoder().decode(pt))
}

/**
 * Merge two item collections by id: newest updatedAt wins; tombstones
 * (deleted:true) are honoured. Deterministic and side-effect free.
 */
export function mergeItems(localItems = [], remoteItems = []) {
  const byId = new Map()
  for (const it of [...remoteItems, ...localItems]) {
    if (!it || !it.id) continue
    const prev = byId.get(it.id)
    if (!prev || (it.updatedAt || 0) >= (prev.updatedAt || 0)) byId.set(it.id, it)
  }
  return [...byId.values()]
}

/** Encode/parse a shareable space code: "wander1.<blobId>.<passphrase>". */
export function encodeSpaceCode(blobId, passphrase) {
  return `wander1.${b64url(blobId)}.${b64url(passphrase)}`
}
export function parseSpaceCode(code) {
  const m = String(code || '').trim().match(/^wander1\.([^.]+)\.([^.]+)$/)
  if (!m) return null
  try {
    return { blobId: unb64url(m[1]), passphrase: unb64url(m[2]) }
  } catch {
    return null
  }
}

/** Client that reads/writes the encrypted blob. fetchImpl injectable for tests. */
export class SyncClient {
  constructor({ blobId, key, fetchImpl, base } = {}) {
    this.blobId = blobId
    this.key = key
    this.fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null)
    this.base = base || SYNC_BASE
  }

  /** Create a new blob, returning its id. */
  static async createSpace({ fetchImpl, base } = {}) {
    const f = fetchImpl || fetch.bind(globalThis)
    const res = await fetchRetry(f, base || SYNC_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ wander: 1, cipher: null }),
    })
    if (!res.ok && res.status !== 201) throw new Error(`create failed HTTP ${res.status}`)
    const loc = res.headers.get('Location') || ''
    const id = loc.split('/').pop()
    if (!id) throw new Error('no blob id returned')
    return id
  }

  async pull() {
    const res = await fetchRetry(this.fetchImpl, `${this.base}/${this.blobId}`, { headers: { Accept: 'application/json' } })
    if (res.status === 404) return []
    if (!res.ok) throw new Error(`pull failed HTTP ${res.status}`)
    const doc = await res.json().catch(() => null)
    if (!doc || !doc.cipher) return []
    return decryptPayload(this.key, doc.cipher)
  }

  async push(items) {
    const cipher = await encryptPayload(this.key, items)
    const body = JSON.stringify({ wander: 1, cipher, updatedAt: nowStamp() })
    const res = await fetchRetry(this.fetchImpl, `${this.base}/${this.blobId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    })
    if (!res.ok) throw new Error(`push failed HTTP ${res.status}`)
    return true
  }

  /** Pull remote, merge with local, push the union back. Returns merged items. */
  async sync(localItems) {
    const remote = await this.pull()
    const merged = mergeItems(localItems, remote)
    await this.push(merged)
    return merged
  }
}

/**
 * fetch with retry/backoff on transient failures (network error, 429, 5xx).
 * Makes sync resilient to flaky mobile connections and any host throttling —
 * the difference between "sync totally failed" and "synced on the 2nd try".
 */
export async function fetchRetry(fetchImpl, url, opts = {}, tries = 4) {
  let lastErr = null
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl(url, opts)
      if (res.ok || res.status === 404) return res
      if (res.status === 429 || res.status >= 500) { lastErr = new Error(`HTTP ${res.status}`) }
      else return res // 4xx (other than 429) won't get better by retrying
    } catch (e) {
      lastErr = e // network/CORS/abort
    }
    if (i < tries - 1) await sleep(500 * Math.pow(2, i)) // 0.5s, 1s, 2s
  }
  throw lastErr || new Error('request failed')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- base64 helpers (work in browser + node) ---
function toB64(bytes) {
  if (typeof btoa !== 'undefined') {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s)
  }
  return Buffer.from(bytes).toString('base64')
}
function fromB64(b64) {
  if (typeof atob !== 'undefined') {
    const s = atob(b64)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  }
  return new Uint8Array(Buffer.from(b64, 'base64'))
}
function b64url(s) {
  return toB64(new TextEncoder().encode(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function unb64url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return new TextDecoder().decode(fromB64(b64))
}
function nowStamp() {
  // Avoid Date.now() at module scope; safe to call at runtime in browser.
  return typeof Date !== 'undefined' ? new Date().toISOString() : null
}
