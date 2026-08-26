#!/usr/bin/env node

import { execFile as execFileCallback, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, writeFile, rename, lstat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_PORT = 7723
const RESERVED_PORTS = new Set([443, 8443, 10000])

export function isTailnetIpv4(value) {
  const parts = String(value || '').split('.').map(Number)
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

export function exactTailnetIpv4(status) {
  const self = status && status.Self
  const candidates = [
    ...(Array.isArray(self?.TailscaleIPs) ? self.TailscaleIPs : []),
    ...(Array.isArray(self?.Addresses) ? self.Addresses : []),
  ]
  const valid = [...new Set(candidates.filter(isTailnetIpv4))]
  if (valid.length !== 1) {
    throw new Error(`Expected exactly one local Tailscale IPv4; found ${valid.length}`)
  }
  return valid[0]
}

export function xrayPort(value = DEFAULT_PORT) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || RESERVED_PORTS.has(port)) {
    throw new Error(`X-ray port must be an unreserved high port; refused ${value}`)
  }
  return port
}

export function workbenchArgs(ip, port) {
  if (!isTailnetIpv4(ip)) throw new Error('X-ray host must be an exact Tailscale IPv4')
  return ['--host', ip, '--port', String(port), '--strictPort', '--base', '/']
}

export function startWorkbenchProcess({
  root = ROOT,
  ip,
  port,
  entry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  runtime = process.execPath,
  env = process.env,
} = {}) {
  const child = spawn(runtime, [entry, ...workbenchArgs(ip, port)], {
    cwd: root,
    env: { ...env, PUBLIC_BASE: '/', VITE_XRAY: '1' },
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  return child
}

export async function waitForHttp(url, child, { attempts = 100 } = {}) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(`X-ray process exited before readiness (${child.exitCode ?? child.signalCode})`)
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1200) })
      if (response.ok) return response.status
      lastError = new Error(`readiness HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`X-ray process did not become ready: ${lastError?.message || 'unknown error'}`)
}

export async function publishXray(root, url) {
  const directory = path.join(root, '.nerv')
  const target = path.join(directory, 'xray.json')
  const temporary = path.join(directory, `.xray.${process.pid}.${Date.now()}.json`)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    await writeFile(temporary, `${JSON.stringify({ url })}\n`, { flag: 'wx', mode: 0o600 })
    // Recheck immediately before the atomic publication; never publish a link.
    const info = await lstat(temporary)
    if (!info.isFile() || info.nlink !== 1) throw new Error('Unsafe X-ray request file')
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
  return target
}

async function tailscaleStatus() {
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { stdout } = await execFile('tailscale', ['status', '--json'], {
        timeout: 10000,
        maxBuffer: 2 * 1024 * 1024,
      })
      return JSON.parse(stdout)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`Could not read local Tailscale status after 3 attempts: ${lastError?.message || 'unknown error'}`)
}

async function main() {
  const status = await tailscaleStatus()
  const ip = exactTailnetIpv4(status)
  const port = xrayPort(process.env.OS3_CONCIERGE_XRAY_PORT || DEFAULT_PORT)
  const url = `http://${ip}:${port}/?xray=1`
  const child = startWorkbenchProcess({ ip, port })
  child.stdout.pipe(process.stdout)
  child.stderr.pipe(process.stderr)

  const stop = (signal) => {
    if (child.exitCode == null && child.signalCode == null) child.kill(signal)
  }
  process.once('SIGINT', () => stop('SIGINT'))
  process.once('SIGTERM', () => stop('SIGTERM'))

  try {
    await waitForHttp(url, child)
    await publishXray(ROOT, url)
    process.stdout.write(`\nOS3 Concierge X-ray ready: ${url}\n`)
    const [code, signal] = await once(child, 'exit')
    if (code && code !== 0) process.exitCode = code
    else if (signal && signal !== 'SIGINT' && signal !== 'SIGTERM') process.exitCode = 1
  } catch (error) {
    stop('SIGTERM')
    if (child.exitCode == null && child.signalCode == null) {
      await once(child, 'exit').catch(() => {})
    }
    throw error
  }
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
if (invoked) {
  main().catch((error) => {
    process.stderr.write(`OS3 Concierge X-ray failed: ${error.message}\n`)
    process.exitCode = 1
  })
}
