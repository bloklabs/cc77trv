import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
const release = 'refs/heads/release/concierge-readable-titles'
const upload = workflow.match(/- name: Upload Pages artifact\n\s+if: (.+)/)[1]
const deploy = workflow.match(/\n  deploy:\n\s+name: [^\n]+\n\s+if: (.+)/)[1]
const verify = workflow.match(/- name: Verify exact publication ref\n\s+if: (.+)\n\s+run: (.+)/)

// These gates use only string comparisons and boolean operators. Actions
// compares strings without case; the shell guard supplies exact ref matching.
function eligible(expression, event, ref) {
  const values = { event_name: event, ref }
  const evaluated = expression.replace(/github\.(event_name|ref) == '([^']+)'/g,
    (_, key, literal) => String(values[key].toLowerCase() === literal.toLowerCase()))
  if (!/^(?:true|false|[\s()&|])+$/.test(evaluated)) throw new Error('Unsupported workflow expression; review the eligibility tests')
  return Function(`return (${evaluated})`)()
}

function exactRefPasses(ref) {
  return spawnSync('bash', ['-e', '-c', verify[2]], { env: { ...process.env, GITHUB_REF: ref } }).status === 0
}

describe('safe Pages release eligibility', () => {
  for (const event of ['push', 'workflow_dispatch']) {
    it(`publishes the exact safe release on ${event} after the test gate`, () => {
      expect(eligible(upload, event, release)).toBe(true)
      expect(eligible(deploy, event, release)).toBe(true)
      expect(eligible(verify[1], event, release)).toBe(true)
      expect(exactRefPasses(release)).toBe(true)
    })
  }
  for (const [event, ref] of [
    ['pull_request', release], ['pull_request', 'refs/pull/6/merge'],
    ['pull_request_target', release], ['workflow_run', release],
    ['push', 'refs/heads/main'], ['workflow_dispatch', 'refs/heads/main'],
    ['push', 'refs/heads/release/another'], ['workflow_dispatch', 'refs/heads/feature'],
    ['push', 'refs/tags/release/concierge-readable-titles'],
    ['workflow_dispatch', release + '-extra'],
  ]) {
    it(`never publishes ${event} on ${ref}`, () => {
      expect(eligible(upload, event, ref)).toBe(false)
      expect(eligible(deploy, event, ref)).toBe(false)
    })
  }
  it('rejects case variants even though Actions equality ignores case', () => {
    const variant = release.replace('release/', 'Release/')
    expect(eligible(verify[1], 'workflow_dispatch', variant)).toBe(true)
    expect(exactRefPasses(variant)).toBe(false)
    expect(exactRefPasses('refs/heads/main')).toBe(false)
  })
  it('tests the exact release PR target without wildcard publication or weaker gates', () => {
    expect(workflow).toMatch(/pull_request:\n\s+branches: \[main, release\/concierge-readable-titles\]/)
    expect(workflow).not.toContain('release/*')
    for (const command of ['npm ci', 'npm audit --audit-level=high', 'npm test', 'npm run lint', 'npm run build', 'npx playwright install --with-deps --only-shell chromium', 'npm run test:browser']) {
      expect(workflow).toContain('- run: ' + command)
    }
    expect(workflow.indexOf('Verify exact publication ref')).toBeLessThan(workflow.indexOf('Upload Pages artifact'))
    expect(workflow).toMatch(/\n    needs: test\n/)
    expect(workflow).toMatch(/permissions:\n  contents: read\n/)
    expect(workflow).toMatch(/permissions:\n      pages: write\n      id-token: write\n/)
    expect(workflow).toMatch(/environment:\n      name: github-pages\n/)
    expect(workflow).not.toMatch(/continue-on-error|always\(\)/)
  })
})
