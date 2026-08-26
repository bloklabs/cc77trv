import { describe, it, expect } from 'vitest'
import { LEGACY_COMPAT } from '../src/lib/compat.js'
import { deriveKey, encryptPayload, decryptPayload, encodeSpaceCode, parseSpaceCode } from '../src/lib/sync.js'

describe('CC77 Wander compatibility contract', () => {
  it('pins every existing on-device storage identifier', () => {
    expect(LEGACY_COMPAT).toMatchObject({
      databaseName: 'wander',
      databaseVersion: 1,
      itemStore: 'items',
      spaceKey: 'wander.space',
      seedFlag: 'wander.seeded',
      autocompletePrefix: 'wander.ac.',
      geoKey: 'wander.geo',
    })
  })

  it('pins the encrypted payload and share-code protocol', async () => {
    expect(LEGACY_COMPAT).toMatchObject({
      pbkdf2Salt: 'wander-cc77-v1',
      pbkdf2Iterations: 100000,
      shareCodePrefix: 'wander1',
      payloadVersionKey: 'wander',
      payloadVersion: 1,
    })
    const code = encodeSpaceCode('legacy-blob', 'legacy-passphrase')
    expect(code).toBe('wander1.bGVnYWN5LWJsb2I.bGVnYWN5LXBhc3NwaHJhc2U')
    expect(parseSpaceCode(code)).toEqual({ blobId: 'legacy-blob', passphrase: 'legacy-passphrase' })
    const key = await deriveKey('legacy-passphrase')
    const encoded = new TextEncoder()
    const base = await globalThis.crypto.subtle.importKey(
      'raw', encoded.encode('legacy-passphrase'), 'PBKDF2', false, ['deriveKey']
    )
    const independentLegacyKey = await globalThis.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2', salt: encoded.encode('wander-cc77-v1'),
        iterations: 100000, hash: 'SHA-256',
      },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )
    const cipher = await encryptPayload(key, { wander: 1, items: [{ id: 'kept' }] })
    await expect(decryptPayload(independentLegacyKey, cipher)).resolves.toEqual({ wander: 1, items: [{ id: 'kept' }] })
  })
})
