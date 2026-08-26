import { describe, it, expect } from 'vitest'
import {
  deriveKey, encryptPayload, decryptPayload, mergeItems,
  encodeSpaceCode, parseSpaceCode, SyncClient,
} from '../src/lib/sync.js'

describe('encryption round-trip', () => {
  it('encrypts and decrypts with the same passphrase', async () => {
    const key = await deriveKey('tokyo-ramen-1234')
    const payload = [{ id: 'a', title: 'Secret spot' }]
    const cipher = await encryptPayload(key, payload)
    expect(typeof cipher).toBe('string')
    expect(cipher).not.toContain('Secret spot')
    const back = await decryptPayload(key, cipher)
    expect(back).toEqual(payload)
  })
  it('fails to decrypt with a wrong passphrase', async () => {
    const k1 = await deriveKey('right-key')
    const k2 = await deriveKey('wrong-key')
    const cipher = await encryptPayload(k1, { x: 1 })
    await expect(decryptPayload(k2, cipher)).rejects.toBeTruthy()
  })
})

describe('mergeItems (last-write-wins + tombstones)', () => {
  it('keeps the newest version of each id', () => {
    const local = [{ id: 'a', title: 'old', updatedAt: '2026-01-01' }]
    const remote = [{ id: 'a', title: 'new', updatedAt: '2026-02-01' }, { id: 'b', title: 'b', updatedAt: '2026-01-01' }]
    const merged = mergeItems(local, remote)
    expect(merged.find((i) => i.id === 'a').title).toBe('new')
    expect(merged.length).toBe(2)
  })
  it('honours tombstones by timestamp', () => {
    const local = [{ id: 'a', title: 'a', updatedAt: '2026-01-01' }]
    const remote = [{ id: 'a', deleted: true, updatedAt: '2026-03-01' }]
    const merged = mergeItems(local, remote)
    expect(merged.find((i) => i.id === 'a').deleted).toBe(true)
  })
  it('ignores records without ids', () => {
    expect(mergeItems([{ title: 'x' }], []).length).toBe(0)
  })
})

describe('space code', () => {
  it('encodes and parses round-trip', () => {
    const code = encodeSpaceCode('019f-blob-id', 'tokyo-ramen-1234')
    expect(code.startsWith('wander1.')).toBe(true)
    const parsed = parseSpaceCode(code)
    expect(parsed.blobId).toBe('019f-blob-id')
    expect(parsed.passphrase).toBe('tokyo-ramen-1234')
  })
  it('rejects malformed codes', () => {
    expect(parseSpaceCode('nope')).toBeNull()
    expect(parseSpaceCode('')).toBeNull()
  })
})

describe('SyncClient with injected fetch', () => {
  it('createSpace reads the Location header', async () => {
    let request
    const fetchImpl = async (_url, opts) => {
      request = opts
      return {
        ok: true, status: 201,
        headers: { get: (h) => (h === 'Location' ? '/api/jsonBlob/abc123' : null) },
      }
    }
    const id = await SyncClient.createSpace({ fetchImpl })
    expect(id).toBe('abc123')
    expect(JSON.parse(request.body)).toEqual({ wander: 1, cipher: null })
  })

  it('sync pulls, merges, and pushes the union', async () => {
    const key = await deriveKey('shared-pass')
    const remoteItems = [{ id: 'r', title: 'remote', updatedAt: '2026-02-01' }]
    let stored = { cipher: await encryptPayload(key, remoteItems) }
    const fetchImpl = async (url, opts = {}) => {
      if (opts.method === 'PUT') {
        stored = JSON.parse(opts.body)
        return { ok: true, status: 200 }
      }
      return { ok: true, status: 200, json: async () => stored }
    }
    const client = new SyncClient({ blobId: 'x', key, fetchImpl })
    const local = [{ id: 'l', title: 'local', updatedAt: '2026-01-01' }]
    const merged = await client.sync(local)
    expect(merged.map((i) => i.id).sort()).toEqual(['l', 'r'])
    // pushed cipher decrypts to the merged union
    const pushedBack = await decryptPayload(key, stored.cipher)
    expect(pushedBack.length).toBe(2)
  })
})
