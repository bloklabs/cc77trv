import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { once } from 'node:events'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  exactTailnetIpv4, isTailnetIpv4, publishXray, startWorkbenchProcess,
  waitForHttp, workbenchArgs, xrayPort,
} from '../scripts/xray-staging.mjs'

describe('Tailnet-only X-ray launcher', () => {
  it('selects one exact local Tailnet IPv4', () => {
    const status = { Self: { TailscaleIPs: ['100.71.81.87', 'fd7a:115c:a1e0::1'] } }
    expect(exactTailnetIpv4(status)).toBe('100.71.81.87')
    expect(isTailnetIpv4('100.64.0.1')).toBe(true)
    expect(isTailnetIpv4('100.127.255.254')).toBe(true)
    expect(isTailnetIpv4('100.128.0.1')).toBe(false)
    expect(() => exactTailnetIpv4({ Self: { TailscaleIPs: [] } })).toThrow(/exactly one/)
  })

  it('uses a distinct high app port and refuses protected services', () => {
    expect(xrayPort()).toBe(7723)
    for (const protectedPort of [443, 8443, 10000]) {
      expect(() => xrayPort(protectedPort)).toThrow(/refused/)
    }
    expect(workbenchArgs('100.71.81.87', 7723)).toEqual([
      '--host', '100.71.81.87', '--port', '7723', '--strictPort', '--base', '/',
    ])
  })

  it('starts and stops a real child HTTP process with the exact bind contract', async () => {
    const entry = path.resolve('test/fixtures/xray-child.mjs')
    const child = startWorkbenchProcess({ ip: '100.71.81.87', port: 7723, entry })
    let buffered = ''
    const ready = new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => {
        buffered += chunk
        if (buffered.includes('\n')) resolve(JSON.parse(buffered.trim()))
      })
      child.once('error', reject)
      child.once('exit', (code) => { if (!buffered) reject(new Error(`fixture exited ${code}`)) })
    })
    const info = await ready
    expect(info).toMatchObject({ hostArg: '100.71.81.87', portArg: '7723' })
    await expect(waitForHttp(info.url, child, { attempts: 10 })).resolves.toBe(200)
    child.kill('SIGTERM')
    const [code] = await once(child, 'exit')
    expect(code).toBe(0)
  })

  it('publishes only the bounded URL payload via an atomic lane drop', async () => {
    const scratchRoot = process.env.TMPDIR || process.cwd()
    const root = await mkdtemp(path.join(scratchRoot, 'os3-concierge-xray-'))
    try {
      const url = 'http://100.71.81.87:7723/?xray=1'
      const target = await publishXray(root, url)
      expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ url })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
